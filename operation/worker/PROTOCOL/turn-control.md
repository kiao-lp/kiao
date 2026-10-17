# Driving a turn

← [worker wire protocol](/operation/worker/PROTOCOL.md) · assumes [socket frames](/operation/worker/PROTOCOL/socket-frames.md) and [turn replies](/operation/worker/PROTOCOL/turn-replies.md).

## Permissions

The CLI is spawned with `--permission-prompt-tool stdio` **in every mode**, which routes each tool
call it would prompt a human about onto the SDK control protocol — a `can_use_tool` request on its
stdout, answered on its stdin. **The flag, not the mode, is what makes manual mode usable**: without
a prompt surface the CLI has nowhere to ask and auto-denies every such call instead. This service is
that surface, and the only one: it relays each ask as a `permission_request` and writes back the
`permission_decision` it receives, echoing the original tool input as `updatedInput` on an allow
because the CLI runs with whatever comes back.

The flag is on the bypass turn too, and for a different reason — see [Questions](#questions) — but
it does not weaken bypass: `--dangerously-skip-permissions` allows a tool call before it is ever
asked about, so nothing about one reaches this service. Should one somehow arrive, it is allowed on
the spot rather than shown, because a card in the mode that promises none would be the worse
surprise.

What survived the move to conversations:

- **A pending request parks the turn.** In `manual` nothing times it out: it ends by being answered,
  by the turn being stopped, or with the service shutting down. Closing the browser leaves the turn
  running and parked, which is why the server logs the subscriber count with every request it relays:
  a turn parked where nobody can see it is greppable. No *deny* timeout was added on purpose —
  auto-denying a tool call the user never saw is the worse failure, and would fire precisely in the
  case this feature exists to support. `manualLive` is the mode for the other case, and it allows
  rather than denies; see below.
- **Pending requests survive a disconnect** and come back in `sync`, so a tab that reloaded — or a
  different tab entirely — can answer what the previous one left open. They are dropped when the turn
  finishes or is stopped.
- **Both modes read stream-json input**, so there is one input path: the prompt is a JSON frame and
  the pipe stays open. The `result` event is what closes it — in this mode the CLI waits for another
  frame after finishing a turn, so nothing exits until its stdin ends.
<a id="manual-live"></a>

### Manual Live

`manualLive` is `manual` to the CLI: same `--permission-mode manual`, same
`--permission-prompt-tool stdio`, same relay. The CLI is never told the word — it has never heard of
it. What the mode adds is **this service's own clock**: a request nobody has answered ten seconds
after it was put up is allowed here, exactly as though the button had been clicked, and the
`permission_resolved` that follows is an ordinary one.

**The countdown is the service's, and that is the change.** It used to be the browser's, which made
the mode a promise only a watched tab could keep: a turn whose chat was not on screen — or whose tab
had been closed — parked on its first tool call and stayed there. A turn keeps running with nobody
connected, so what answers its cards has to keep running too. That is what makes a board playable
with the laptop shut, which is what the mode is mostly used for.

A connected client is told the deadline: `permission_request` carries `decideAt`, epoch millis, and
`sync` replays it with the pending card. So every tab counts down to the *same* instant — one that
reconnected mid-count included — shows what is about to happen, and can Deny before it. A client that
renders no countdown at all still gets the mode it asked for; it simply says less about it.

`manual` is the other one, and it is untouched: nothing times a request out, and the turn waits for a
human however long that takes. The paragraph above holds for it in full.

The mode is on the wire, rather than being a checkbox the browser keeps to itself, so that the choice
lives on the conversation like the others and every tab watching the turn treats its cards the same
way. That is also why `sync` carries it.

A **question** is never counted down, in any mode: `manualLive` allows a call whose answer it can
guess, and there is nothing to guess in a question put to the user — see *Questions*.

- A control request this service cannot surface (`request_user_dialog`, `elicitation`) is answered
  with an error rather than ignored, which would park the CLI on it.

<a id="between"></a>

## Between

A **between** is something said into a turn that is *already running*, without starting one. It is
the answer to the ordinary case of watching a turn go the wrong way: the alternatives used to be
stopping it — throwing away everything it had done — or waiting for it to finish and then correcting
it, which is a whole turn of work spent on the wrong thing.

**The mechanism is the CLI's own command queue, and it is why this is possible at all.** The CLI's
stdin stays open for the whole turn — it is the pipe permission answers travel back on — and a
`{"type":"user","message":{…}}` frame written to it *mid-turn* is not read as a second prompt. The
CLI enqueues it and **folds it into the turn already in flight**, at that turn's next tool boundary.
The model reads it as a message from the user, in the middle of its own work, and carries on: one
process, one `result`, one transcript record for the reply. There is no second turn, no second
`start`, and nothing to wait for.

That mechanism is what the whole design follows from:

- **It only exists while a turn does.** A between for a conversation with nothing running is refused
  with `no_running_turn` and never held for the next turn. Queueing it would be a different feature
  wearing the same name: the user typed it about the reply they were watching, and delivering it to
  whatever came next — minutes or days later, possibly with a different model and mode — is not what
  they asked for. The refusal says so and hands the message back, which costs one more click and
  says something true.
- **The pipe is what decides.** A turn is registered until it is swept, and its `isDone` flag is
  only set once the process has actually exited — but the CLI's stdin is closed the moment its
  `result` event arrives. So the write is the real check, and a between that loses that race is
  refused exactly like one that arrived an hour late. Both are `no_running_turn`.
- **It carries nothing but text.** No model, no effort, no permission mode: those were fixed when
  the turn was spawned and cannot be changed under it. No attachments either, and no attachment or
  image note — the turn has already been told what it was handed, and repeating it inside one
  would be telling the model something it knows. Nothing bounds its length but what bounds a
  prompt's: the 1 MiB frame cap, and the record cut. A cap of its own could only be refused with a
  code about something other than the turn, and this frame has none.

  There is a related consequence worth stating: a between long enough to be cut by
  `normaliseRecord` reaches the model whole and the transcript short. That is already true of a
  prompt, and is the honest trade — what was *said* is what the CLI got.
- **It is written to the CLI first, then recorded, then announced.** The opposite of a prompt's
  ordering, and right for the opposite reason: a prompt's record is written before the spawn so an
  interrupted turn always leaves a dangling user record to close, while a between has no such duty —
  the turn's record is already dangling. What it must not do is tell every tab that something was
  said to the agent when the pipe had in fact closed.
- **It is the user's own message, and the transcript says so.** The record's role is `user`; a
  `between: true` flag says only that it landed inside a turn rather than starting one. A turn's
  records therefore read prompt, betweens, reply. That the reply had begun before the betweens were
  said is unrepresentable — the whole reply is one record — and is deliberately not faked.
- **Every subscriber is told**, by a `between` frame carrying the same text, and `sync` replays the
  whole list. Two tabs watching one turn have to agree about what was said into it, and the tab that
  typed it learns from that frame too rather than from a guess of its own.
- **It is an action on the turn, not a look at it**, so it is held to the same ownership rule as a
  `stop`: a caller who is not the turn's owner is refused with `not_permitted`.

Nothing about a permission mode applies to it. A between is not a tool call and is not asked about;
it is the user talking, which every mode allows.

<a id="questions"></a>

## Questions

`AskUserQuestion` is the tool a turn calls to **put a question to the user** rather than guess at the
answer: which of these approaches, which of these names, is this what you meant. It arrives as an
ordinary `can_use_tool` request — same protocol, same parking, same `permission_resolved` — and it is
answered as one, an allow whose `updatedInput` the CLI runs the tool with. What rides in on that
input is the answers, keyed by question text, which is the map the tool reads and prints back to the
model.

Everything else about it is deliberately *not* a permission:

- **It is a frame of its own.** `question_request` carries the questions structured — text, header,
  `multiSelect`, and options of label, description and preview — because the user is choosing an
  answer, not judging a tool call, and a card that showed them indented JSON would be asking them to
  read the model's question out of its own serialisation. `question_answer` sends back one string per
  question, positionally: the client answers the frame it was sent, and two questions worded the same
  must not collapse into one answer.
- **Nothing ever answers it on the user's behalf.** `manualLive` allows a card whose answer it can
  guess after ten seconds; a question has no such answer, and guessing one would put words in the
  user's mouth that the model then acts on. A question waits, in every mode, until it is answered or
  dismissed — or until the turn is stopped, exactly like a permission left pending.
- **It is asked in `bypassPermissions` too.** That mode is about which tool calls may run, and it has
  no opinion about what the user thinks. This is the reason `--permission-prompt-tool stdio` is on
  every turn: a CLI with nowhere to ask does not merely auto-deny AskUserQuestion, it does not offer
  the model the tool at all — a turn that wanted to ask would be told the tool does not exist.
- **A dismissal is an answer.** It sends the empty map, and the tool tells the model the question was
  not answered. That is true, and it is better information than a made-up answer; leaving the card
  alone instead parks the turn, which is the other legitimate choice and says nothing.
- **The questions go back exactly as they came.** The service clones the tool input and adds
  `answers` — and `annotations`, carrying the preview of the option that was picked, since the model
  wrote those previews to be compared. The copy on the frame is trimmed to what a sidebar can render
  and is never what is sent back: the CLI validates `updatedInput` against the tool's own schema.
- **An ask this service cannot read as a question falls back to a permission card.** Refusing to
  render it would park the turn on something nobody can see or dismiss; the permission card at least
  shows the raw input and has a button.

<a id="withdrawing-bypass"></a>

### Withdrawing bypass

`KIAO_WORKER_HYBRIDFLOW_RUNNER_BYPASS_ENABLED=false` takes `bypassPermissions` off the table for a whole
deployment — the kiao image ships this way, a local or server service does not. Three things
change, and nothing else does:

- `/hybridflow-runner/options` offers two modes instead of three, so the toolbar cannot present a choice that
  would be refused the moment it was used.
- Every place a mode can be **set** refuses it: `400` from `POST`/`PATCH /hybridflow-runner/conversations`,
  `error{bypass_disabled}` on the socket. The socket checks the mode the conversation *stores* as
  well as the one the frame carries, because an omitted field resolves to the stored one — a
  conversation created while bypass was allowed must not go on running unasked turns after it was
  withdrawn. It is refused rather than quietly downgraded: the toolbar displays the mode, and running
  a different one than it shows is the one outcome worse than saying no.
- A request that names no mode, on a conversation that stores none, resolves to `manual` instead of
  `bypassPermissions`.

`claudeArgs` (`hybridflow-runner/driver_claude.go`) is the one place `--dangerously-skip-permissions` is
spelled, and it is also what
refuses to spell it: a turn that somehow reached it in bypass mode on such a service is spawned with
the manual flags instead. The gates above mean nothing reaches it; that is what keeps it true of a
path added later.

What changed:

- **The mode belongs to the conversation**, and a `prompt` overriding it for one turn makes that
  override the conversation's new default. An unknown value is refused where it is *set* — `400` from
  `POST`/`PATCH /hybridflow-runner/conversations`, `error{unknown_permission_mode}` on the socket — and never
  guessed at: reading it as either mode would silently give the turn more or less freedom than was
  asked for.
- **A decision is addressed by conversation, not by socket.** Any socket may answer a request —
  subject to the ownership rule below, and not necessarily the one that received it — the outcome
  reaches every subscriber as `permission_resolved`, and a decision for a request that is no longer
  pending is dropped rather than written to the CLI a second time.
- **Acting on a turn is owner-only.** `stop` and `permission_decision` from an authenticated user who
  is not the turn's owner are refused with `error{not_permitted}`. Subscribing and reading stay open —
  visibility is the registry's call — and an empty owner or an empty caller (debug auth mode) permits,
  so a single-user deployment is unaffected.
- **The folder bounds where a turn starts, not what it may touch.** The whole store root is handed to
  the CLI as `--add-dir`, so a turn started in one folder reaches every other without asking — the
  store is one tree and the work crosses it. Nothing is granular here: containment is the permission
  mode and the human answering it, and in `bypassPermissions` no tool call is asked about at all.
- **`--setting-sources` defaults to `user`**, so a `.claude/settings.json` arriving in the content
  store through `git pull` is not loaded. `--print` loads project settings — and runs project hooks —
  with no prompt of any kind, and the working directory is inside a tree the user pulls into.

## Turn lifecycle

A **turn** is one `claude` process: one prompt, one reply. It belongs to a conversation, it is
identified by a server-minted `turnId`, and it is the only thing the socket streams.

- **One turn per conversation.** A second `prompt` while one runs is refused with
  `conversation_busy`. Replacement — what this hub used to do — is indefensible once a conversation is
  durable: the turn it killed has already recorded the user's message, so its half-finished reply
  would be filed under a prompt the user can still see, and the CLI session would carry an
  interruption nobody asked for.
- **At most `KIAO_WORKER_HYBRIDFLOW_RUNNER_MAX_TURNS` (default 4) turns run at once**, across every
  conversation; one over is refused with `too_many_turns`. `hello.maxConcurrentTurns` reports the cap,
  so a client can say what the limit is rather than only that it was hit.
- **A turn costs two transcript writes**, whatever the reply's length — plus one per `between`:
  the user's record before anything is spawned, then the whole reply and its tool calls as one
  record when it settles. Streaming never touches the disk. The first of those is written *before*
  the spawn on purpose — the record exists before the process that could be interrupted does, so an
  interrupted turn always leaves a dangling user record for the next startup to close. A between's
  record is written after its text has reached the CLI, which is the opposite ordering and right for
  the opposite reason: the turn's record is already dangling, and what a between must not do is tell
  every tab something was said to the agent when the pipe had in fact closed.
- **A settled turn lingers 30 minutes** in the registry and a janitor sweeps it every 5 minutes.
  Delivering `done` does **not** evict it, which is the change from the previous protocol: with
  several subscribers the first collector would take the turn away from the rest, and a `subscribe`
  arriving just after a turn ended has to be answerable.
- **Stopping is ordered, not racy.** The turn is marked superseded before the kill, so nothing its
  goroutine drains afterwards can land after `stopped`; the transcript record is written with
  `interrupted`, and the registry frame follows.
- **Shutdown kills every running CLI process** so none outlives the service, and deliberately leaves
  the conversations marked running: the next startup settles each with an `interrupted` assistant
  record carrying no text, because the reply died with the process and inventing one would put words
  in the model's mouth.
- **A `--resume` the CLI refuses is a lost session** — the one failure that changes the conversation
  rather than merely recording it. A non-zero exit with no `system` event ever emitted clears the
  stored session id, sets `sessionLost`, and appends a `notice` record saying the history above is now
  reading material rather than context. It is a diagnosis of the CLI's own exit, so it is only ever
  read from one: a turn *we* ended — a stop, a failed spawn — has the same shape and is never a lost
  session.
