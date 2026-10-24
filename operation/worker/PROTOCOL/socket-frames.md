# Socket frames

← [worker wire protocol](/operation/worker/PROTOCOL.md) · assumes [agents](/operation/worker/PROTOCOL/agents.md) and [conversations](/operation/worker/PROTOCOL/conversations.md).

## WebSocket: `/ws/hybridflow-runner`

One long-lived socket per browser tab, carrying every conversation that tab is watching. The socket
is not a turn and never owns one: a turn belongs to its **conversation**, and it keeps running, keeps
parking on an unanswered permission request and keeps writing its transcript whether or not anyone is
connected — a socket that dies drops its subscriptions and touches no turn at all. Every frame is a
JSON object discriminated by `type`, and every frame but `hello` carries a `conversationId`.

**This protocol breaks compatibility deliberately, and fails loudly rather than negotiating.**
`flowNodeId`, `attach`, `prompt.path` and `prompt.sessionId` are gone: a turn is keyed by a
server-owned `conversationId` and takes its folder and its `--resume` session from the conversation
record. `ADDING-AN-ENDPOINT.md`'s "wire compatibility is sacred" rule governs the **HTTP** surface,
whose field names came from the retired Java service and whose clients this repository does not all
control — and REST here is purely additive, five new endpoints and not one changed shape. The socket
has exactly one consumer, shipped from this repository: `kiao-mcp` never opens it and `WorkerClient`
has no socket support at all. That stays true now that a turn is given the `kiao-mcp` servers
(`--mcp-config`, see `hybridflow-runner/claude_mcp.go`) — the relationship runs the other way: a turn started
on this socket spawns them, and they call back in over the plain REST API with a token this service
minted for that turn. A deprecated `flowNodeId` alias was considered and rejected — an old bundle
would still send `attach`, still expect one job per socket and still mint its own ids for a registry
that no longer accepts them, so it would half-work rather than fail, which is the worse outcome.
`hello.protocolVersion` (currently `20`) is what makes it fail cleanly: a client built against
another number stops reconnecting and tells the user to reload, instead of sitting on a socket whose
frames it cannot route. **Bump it whenever a frame's shape changes** — in `agentProtocolVersion`
(`hybridflow-runner/claude_ws.go`) and `AGENT_PROTOCOL_VERSION` (`agent-types.ts`) together.

**The path is `/ws/hybridflow-runner`**, and `/ws/agent` and `/ws/claude` still answer it: the same hub,
the same `hello`. The old paths cost one line each to keep and save a bundle cached from before
either rename, but they promise nothing — the version above is the whole of what this surface
guarantees.

## Frame classes

Three, and the distinction is what decides who a frame reaches:

| Class | Carries | Delivered to |
|---|---|---|
| **socket-scoped** | no `conversationId` | the one socket, unprompted |
| **registry-scoped** | `conversationId`, no `turnId` | **every** open socket, subscribed or not |
| **service-scoped** | no `conversationId` | **every** open socket |
| **conversation-scoped** | `conversationId`, usually `turnId` | only the sockets subscribed to that conversation |

`hello` is the only socket-scoped frame; `conversation` and `conversation_deleted` are the only
registry-scoped ones; `chainRun` is the only service-scoped one — it is about the boards being played,
which are the whole service's, so it belongs to no conversation and reaches everybody.
Everything else is conversation-scoped.

A client **routes on `conversationId` and fences on `turnId`**: a frame carrying a turn id other than
the one it is rendering is a straggler from a turn that has ended, and appending it would write one
turn's output into another's bubble.

The registry class exists because a conversation list has to stay live in a tab that is looking at
something else, which is the one thing a subscription-scoped fan-out cannot do. And subscribers live
on the hub keyed by conversation, never on a turn: a turn is one CLI process, so a subscriber set
living there would be lost at every turn boundary, and there would be nowhere at all to record
interest in a conversation with no turn running — which is the normal state of the one the user is
looking at.

## Client → server

| `type` | Fields | Meaning |
|---|---|---|
| `subscribe` | `conversationIds` (or `conversationId`) | Register interest. Additive, idempotent, and legal for a conversation with no turn running. Each id is answered — to this socket alone — with a `sync` or a `not_running`. Re-sending it is how a client forces a resync after a reconnect. |
| `unsubscribe` | `conversationIds` (or `conversationId`) | Stop receiving those conversations' frames. Their turns keep running. |
| `prompt` | `conversationId`, `prompt`, `model?`, `effort?`, `thinking?`, `permissionMode?`, `attachments?` | Start a turn, subscribing this socket to the conversation as a side effect. The four settings override the conversation's stored defaults for this turn **and become its new defaults**; omitted, the stored ones apply. `thinking: false` disables extended thinking (`CLAUDE_CODE_DISABLE_THINKING=1`). `permissionMode` is `manual`, `manualLive` or `bypassPermissions`; anything else is refused, as is `bypassPermissions` on a service that has withdrawn it. A prompt for a conversation whose turn is still running is refused with `conversation_busy` — it never replaces it. `attachments` is up to ten ids from `POST /hybridflow-runner/attachments`, in the order the user attached them; ids and never paths, and every one of them must still be there or the turn is refused with `bad_attachment`. Unlike the four settings it is **not** kept as a default: an attachment belongs to the one message it was attached to. |
| `between` | `conversationId`, `text` | Say something into the turn that is **already running**, without starting one. The text is written to the CLI's open stdin, which enqueues it and folds it into that turn at its next tool boundary; the model reads it there and carries on. No settings ride along — the turn's were fixed when it began — and no attachments. Refused with `no_running_turn` when there is no live turn to fold it into, or when its pipe has already closed; refused with `not_permitted` when the caller does not own the turn. Its length is bounded by the same two things a prompt's is — the 1 MiB frame cap, and the record cut — and by nothing of its own. An empty one is dropped in silence. Every subscriber gets a `between` frame carrying the same text. See [Between](/operation/worker/PROTOCOL/turn-control.md#between). |
| `stop` | `conversationId` | Kill the conversation's running turn. An unknown or idle conversation is a no-op. |
| `permission_decision` | `conversationId`, `requestId`, `behavior`, `message?` | Answer a `permission_request`. `behavior` is `allow` or `deny`; `message` is the reason the model is told on a deny. Anything unanswerable — a second answer to the same `requestId`, an unknown request, a turn that has since ended — is dropped without reaching the CLI. |
| `question_answer` | `conversationId`, `requestId`, `answers` | Answer a `question_request`. `answers` is one entry per question, **in the order they were asked**: the chosen option's label, the several labels comma-separated for a multi-select, or whatever the user typed instead. A blank entry is a question left unanswered, and all blanks is a dismissal. Unanswerable frames are dropped as above — and a `question_answer` never answers a permission, nor a `permission_decision` a question. |

`subscribe` and `unsubscribe` read **both** id fields and act on the de-duplicated union, so a client
batching a single id has nothing to think about; the others read `conversationId` alone. A
`prompt` without one is dropped with a log line and no answer — every conversation-scoped frame is
routed on that id, so a client that omitted it could not match a refusal to its request anyway.
Unknown `type` values are logged and ignored, and one inbound frame is capped at 1 MiB.

**The folder and the CLI session come from the conversation record, never from the client.** That is
what `path` and `sessionId` used to carry: the working directory is the conversation's folder,
resolved at every turn rather than at creation only, and `--resume` takes the
session id the conversation stored when its last turn announced one. It is stored the moment the
`system` event carries it rather than when the turn settles, because a turn that is interrupted never
settles: the id would die with the process, and the next turn would start a fresh session.

The folder travels as the process working directory rather than as prose in the prompt. When the
frame carried `attachments`, the server appends a note naming each one's absolute path (see [Agent attachments](/operation/worker/PROTOCOL/conversations.md#agent-attachments)); a played flow node's images get a note of their own (see [Playing a board](/operation/worker/PROTOCOL/chain-runs.md#playing-a-board)).
A trailing `Working folder: <path>` note used to say the same, and was removed: the CLI runs where
the conversation's folder is, so relative paths resolve there without being told.

**What the reply is rendered by is `--append-system-prompt`, not the prompt.** Dashboard renders a
reply with the same markdown renderer it renders the store's documents with, and two of its
capabilities are unusable unless the model knows it has them: a fenced `mermaid`, `plantuml`,
`archdia`, `graph` or `svg` block is *drawn*, and a link whose destination is a store path with a
leading slash — `/units/abc/cadre.md` — opens that file in the CMS. The briefing that says so
(`hybridflow-runner/driver_claude.go`) is appended to the system prompt because it is a property of the surface,
identical on every turn: putting it in the prompt would repeat it per message and leave it in the
transcript the user reads back. It is anchored to this deployment's store root, so an absolute path
the turn has just read can be turned into a link.

## Server → client

| `type` | Scope | Fields | Meaning |
|---|---|---|---|
| `hello` | socket | `protocolVersion`, `socketId`, `runningConversations`, `maxConcurrentTurns`, `agents`, `chainRuns` | Sent once, unprompted, on connect — so a client that has just reconnected knows what is still running, and whether this service speaks its protocol at all, before it asks anything. `runningConversations` is sorted, so a client and a test can compare it. `agents` is every agent this deployment offers, **the first being the default** — the names alone, because whether there is a choice to draw is part of what a tab needs before it draws anything, while *what each one offers* is the heavier answer at `GET /hybridflow-runner/options`. `chainRuns` is every chain run the service knows right now, for the same reason: a tab has to know before it draws one. |
| `chainRun` | service | `runs`, `notice?` | A chain run changed — a flow node started, a chat being shortened, a wait between two tries, a flow node held until a usage limit lifts, a run that ended. `runs` is always the **whole** list, oldest first, rather than the run that moved: a client merging deltas would be a second place the truth lived. `notice` is a line one run decided is worth saying (`level`, `text`, `at`, `chainRun`): a chain that ended, a flow node tried again at twenty past, a folder that does not match. `chainRun` is the name of the run that decided it — several speak at once, and an unattributed line names none of them. It is sent once, to every socket, at the moment the run decided it, and a client shows it as it comes rather than working one out for itself. |
| `conversation` | registry | `conversationId`, `conversation` | A conversation was created, renamed, archived, started or settled. `conversation` is the same `AgentConversationDto` a REST read returns, so a client never reconciles two views of one conversation. |
| `conversation_deleted` | registry | `conversationId` | It is gone; drop it from the list. |
| `start` | conversation | `model`, `effort`, `thinking`, `permissionMode`, `agent`, `folder`, `startedAt` | A CLI process spawned, carrying the settings the turn actually runs with, so a tab that was not watching when it began can label it without a REST round trip. `startedAt` is epoch millis. |
| `session` | conversation | `sessionId` | The CLI reported its session id. It is recorded server-side; a client needs it only to display. |
| `output` | conversation | `index`, `kind`, `data` | An incremental **delta** of the turn's block at `index`, not its full text. Append blindly. `kind` is `text` or `thinking`, so a client can create the block on first sight; the delta may be empty, which is how a block with nothing to show (redacted thinking) still opens. |
| `tool_use` | conversation | `index`, `name`, `input`, `detail`, `toolUseId?`, `result?`, `isError?`, `exitCode?` | The turn's block at `index` is this tool call. `input` is a summary — JSON-encoded, truncated to 80 chars with an ellipsis — and `detail` the whole input as indented JSON, cut at 4000 characters. `result` is what the call returned, cut at 8192, and travels with the call when the outcome arrived with it; a result that arrives later is filed on the transcript's copy alone. |
| `subagent` | conversation | `index`, `kind`, `text`, `subagent?` | The turn's block at `index` is this delegation: work the turn handed to a subagent. `text` is the parent's summary line, and `subagent` is what the child thought and did — the metadata (`subagentId`, `childSessionId`, `role`, `objective`, `status`, `result`, `durationMs`, `truncated`) and the child's own `blocks`, in the order it produced them, with its nested delegations the same way. It arrives whole, like a tool call: set it at its index rather than appending. |
| `background` | conversation | `tasks` | The turn's background work, whole: every workflow, delegation and backgrounded tool call it has handed off, in first-sight order, finished ones kept — with a workflow's folded children beneath it. Replace, do not append. See [Background work](/operation/worker/PROTOCOL/turn-replies.md#background-work). |
| `permission_request` | conversation | `requestId`, `toolName`, `displayName?`, `description?`, `input?`, `toolUseId?`, `decideAt?` | The turn is parked until this is answered. `input` is the tool's whole input as indented JSON, cut at 4000 characters on a rune boundary — long enough to decide on, unlike the 80-char `tool_use` summary. `decideAt` is epoch millis and `manualLive` only: the moment this service will allow the call itself. |
| `question_request` | conversation | `requestId`, `toolName`, `questions`, `toolUseId?` | The turn asked the user something and is parked until it is answered. `questions` is the ask itself, structured for a card rather than dumped as JSON: each carries `question`, an optional `header` chip, `multiSelect`, and `options` of `{label, description?, preview?}`. The options are a suggestion, never a closed list — a free-text answer is always legal, and a question may arrive with no options at all. |
| `permission_resolved` | conversation | `requestId`, `outcome` | The request left the pending set: `allow`, `deny`, or `cancelled` when the CLI withdrew it. Every subscriber gets it, so a second tab showing the same card settles too. An answered question settles through it as an `allow` — answering it is what the tool call was for. |
| `between` | conversation | `text` | Something was said into this turn while it ran. Sent to every subscriber, so a tab that did not type it shows it too. It is not a block and never appears in `blocks`: the blocks are the turn's own account of itself, and this is the user interrupting it. |
| `notice` | conversation | `text` | A line the turn's driver wants shown while it works — a silence naming itself, a wait worth knowing about. Ephemeral: never written to the transcript, never ending the turn, and each one supersedes the last. |
| `done` | conversation | `exitCode` | The process exited. Never sent for a turn that was stopped — that one settles on `stopped`. |
| `stopped` | conversation | — | Acknowledges `stop`, and is that turn's last word: whatever its stream was still draining is dropped behind it. |
| `sync` | conversation, to the asking socket | `turnId`, `running`, `userText`, `betweens`, `blocks`, `permissionMode`, `agent`, `pendingPermissions`, `pendingQuestions`, `background`, `sessionId?`, `startedAt`, `finishedAt?`, `exitCode?` | The whole state of the conversation's current or last held turn, in answer to `subscribe`. `blocks` is that turn's **full** block list — replace, do not append; so is `betweens`, everything said into it since it started, in order; so is `background`, the turn's whole background roster. `permissionMode` repeats what `start` carried, because it is how the replayed `pendingPermissions` are to be treated and the conversation record does not learn it until the turn settles. |
| `not_running` | conversation, to the asking socket | — | Subscribed, but no turn is held for this conversation. The normal state of an idle one. |
| `error` | conversation | `code`, `message` | A turn was refused or failed. `turnId` is present only when there was a turn to pin it to — a prompt refused before anything is spawned carries none. |

`sync` and `not_running` go to the socket that asked and to no other: they are replays of state
rather than events, and broadcasting one would rewrite the other tabs' view of a turn they are
already following correctly. `pendingPermissions` and `pendingQuestions` carry the earlier
`permission_request` and `question_request` frames verbatim, so each still carries its own `type`.
They are two lists rather than one because the two are answered by different frames: a client that
put a question through the permission path would allow the tool call without collecting the answer
it was made for. What is *not* in a `sync` is the completed transcript
— that is `GET /hybridflow-runner/conversations/{id}`; this frame is only about the live turn, which is the part
REST cannot have.

## Flows

```
connect          →  hello (protocolVersion, runningConversations)
subscribe[a,b]   →  sync{a}  /  not_running{b}
prompt{a}        →  conversation{a}  →  start{a,t1}  →  session{a,t1}
                                      →  output{a,t1}* / tool_use{a,t1}*
                                      →  done{a,t1}  →  conversation{a}
prompt{b}        →  start{b,t2} → …                    (interleaved on the same socket)
prompt{a} again  →  error{a, conversation_busy}        (a turn never replaces a turn)
between{a}       →  between{a,t1}                          (into the turn, no new one)
between{a} idle  →  error{a, no_running_turn}                (nothing is queued for later)
stop{a}          →  stopped{a,t1}  →  conversation{a}
unsubscribe[b]   →  —                                  (b's turn keeps running)
socket dies      →  —                                  (every turn keeps running)
reconnect        →  hello  →  subscribe[a,b]  →  sync{a} / sync{b}

prompt (folder gone)       →  error{code:'bad_folder'}                 (nothing spawned)
permission_request{a,t1}   →  permission_decision{a}  →  permission_resolved{a,t1}  (manual only)
question_request{a,t1}     →  question_answer{a}      →  permission_resolved{a,t1}  (every mode)
```

Two orderings in there are contractual. The registry frame that marks a conversation busy goes out
**before** `start` and the one that marks it idle **after** `done` / `stopped`: the turn's own frame
settles the bubble, the registry frame settles the list. And the turn's transcript record is written
before `done` or `stopped` reaches the client, because that frame is what sends a client back to REST
for the transcript — a read that raced the write would show a turn with no reply.

`output` deltas are computed against the text of the block they address, so a client appends them
blindly. After a `sync` it holds the whole block list and must replace rather than append, which is
also what repairs a socket that missed frames: the fix is replacement, not replay.

## Subscriptions

A subscription is interest in a **conversation**, and it is the only thing a socket owns. It is
additive and repeatable, it survives every turn boundary, and it is legal — normal, in fact — for a
conversation in which nothing is running.

- **Subscribing never takes a turn away from anyone.** Several sockets may watch one conversation and
  each gets every frame; nothing is consumed by the first to arrive.
- **`prompt` subscribes**, so a client cannot miss its own reply by forgetting to ask for it first.
- **`unsubscribe` drops the interest, never the work**, and so does a socket that dies: it releases
  its subscriptions and touches no turn at all.
- **Registry frames ignore subscriptions entirely** — that is the whole point of the class.
- **A settled turn still answers a `subscribe`** for as long as it is held (30 minutes). That is what
  closes the gap between a client's REST read and its subscribe: a turn that finished in between is
  still reported, with `running: false` and its exit code, instead of vanishing.
- **The socket is heartbeated.** The server pings every 30 s and drops one that has not answered
  within 75 s; browsers answer pongs on their own, so a client has nothing to implement. nginx cuts
  an idle socket at 3600 s (`deploy/nginx/kiao.conf`), far above the ping interval, so the heartbeat —
  not the proxy — is what decides an idle tab is still there. Each write carries a 10 s deadline, so a
  wedged browser is dropped rather than parking the turn that was writing to it.

Protocol 20 adds optional deferred-message commands and queue snapshots; see [Pi execution profiles](/operation/worker/PROTOCOL/pi.md).
