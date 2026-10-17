# Panel suites

> Detail of [ARCHITECTURE.md](../../../../exchange/dashboard/ARCHITECTURE.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

A panel is a **tool bar tab**: `{ id, title, icon, defaultBar?, flush?, render(bar) }`, registered
for as long as its declaration is mounted and drawn wherever the open document puts it — see [Tool bars](tool-bars.md)
for the frame, and `toolBars` in the plugin manifest for how one is declared. The two
big suites:

- **Git (Source Control)** — [`GitPanel.tsx`](../../../../exchange/dashboard/src/cms-core/toolbar/GitPanel.tsx), the
  status/stage/commit view, over two hooks: [`useGitStatus.ts`](../../../../exchange/dashboard/src/cms-core/toolbar/useGitStatus.ts)
  (last-request-wins `git status` polling) and [`useGitActions.ts`](../../../../exchange/dashboard/src/cms-core/toolbar/useGitActions.ts)
  (stage/unstage/revert/commit/consolidate/push/pull with panel-local toast/modal result reporting).
  [`GitConsolidateModal.tsx`](../../../../exchange/dashboard/src/cms-core/toolbar/GitConsolidateModal.tsx) confirms the one
  irreversible action the panel offers — squashing the whole history into a single commit to
  reclaim the space it holds, force-pushing that rewrite when the branch tracks an upstream (which
  is what decides whether anything is actually freed); it is reached from the Changes section's
  "More actions" menu, and its report comes back in a modal rather than a toast.
  [`GitDiff-ctx.tsx`](../../../../exchange/dashboard/src/cms-core/toolbar/GitDiff-ctx.tsx) +
  [`GitDiffView.tsx`](../../../../exchange/dashboard/src/cms-core/toolbar/GitDiffView.tsx) (diff target + diff body, pushed onto
  the central area's stack over whatever is showing),
  and [`GitSyncMonitor.tsx`](../../../../exchange/dashboard/src/cms-core/toolbar/GitSyncMonitor.tsx) (fetches the remote on
  mount, prompts to pull when behind, and surfaces ahead/uncommitted counts). All gated by
  `gitEnabled`.
- **The chat** — [`plugins/chat/ChatPrompt.tsx`](../../../../exchange/dashboard/src/plugins/chat/ChatPrompt.tsx) is the
  panel and [`plugins/chat/ChatConversationPane.tsx`](../../../../exchange/dashboard/src/plugins/chat/ChatConversationPane.tsx)
  is one chat in it: its transcript, the cards a parked turn waits on,
  and the box with the settings the next turn runs with. The switcher's title bar carries **one starter per agent** the deployment
  offers rather than a single `+`: the agent is the one thing about a conversation that can never be
  changed afterwards — a session id belongs to one engine — so the box carries no agent control at
  all, and a lone `+` could only ever have made another conversation on the engine already open.
  Each starter is drawn with a plus of its own (bare, squared, circled, by
  position rather than by engine, since which agents exist is the service's answer) and named in
  full by its tooltip. The box's model, effort and mode travel with the starter that is that box's
  own agent and with no other: they are one engine's vocabulary, and a mode the other does not
  publish is a `400`. The panel holds **several panes at once**, because a conversation can be
  **pinned** — the switcher then takes it out of the list and gives it a column of its own, left of
  the list, so two or three chats are watched and answered side by side instead of switched between.
  `pinned` is a field of the conversation record like `archived`, so the arrangement is the same in
  the next tab and on the next machine; it changes nothing about how a turn runs, and a pinned
  conversation is still listed by the service exactly like any other. A conversation can also be
  **forked**, and forking is asked of a **message** rather than of that row of actions — *where* a
  conversation branches is the whole of what a user is choosing when they fork one, and a button
  above the transcript could only ever have meant "at the end". Every user prompt in the chat carries
  the action; the copy holds everything above that prompt and stops short of it, and the prompt's own
  text comes back to the main column's box, because branching at a prompt is asking it again,
  differently. The panel switches to the copy and leaves the original untouched. It is a service call
  and not a browser-side copy (`POST /hybridflow-runner/conversations/{id}/fork` with `fromMessageId`), because
  the session is the service's: the fork's first turn branches off it with `--fork-session`, cut at
  the reply the copy stops on with `--resume-session-at`, so Claude remembers exactly what the copy
  shows and no more. This is the same shape, and the same mechanism, as the Claude Code VS Code
  extension's own *Fork conversation from here*. Everything that is one per
  panel — the socket, the registry, the option lists — is read in the panel and handed down, so N
  columns are still one of each. A tool bar has **no width ceiling**: how
  much room several columns need is the user's judgement, and the only bound left is keeping the
  resize handle inside the window. The socket lifecycle lives in
  [`plugins/chat/ChatSocket-ctx.tsx`](../../../../exchange/dashboard/src/plugins/chat/ChatSocket-ctx.tsx), which connects to
  `${ws|wss}://<host>/api/ws/hybridflow-runner` (backend `worker` `/ws/hybridflow-runner`), handles
  prompt/attach/stop and streams one agent's CLI session. It types the wire with `kiao-worker`'
  `AgentClientMessage` / `AgentServerMessage` and switches exhaustively over the server union,
  so a new server message type fails the build.
  A reply is **a list of blocks in the order the model produced it** — text, thinking and tool calls
  interleaved — carried by `output`/`tool_use` frames that address a block by index, replayed whole
  by `sync`, and stored that way in the transcript, so a conversation reads back afterwards as an
  account of what happened. [`plugins/chat/ChatMessageList.tsx`](../../../../exchange/dashboard/src/plugins/chat/ChatMessageList.tsx)
  renders them in that order and never sorts or hoists: thinking is a collapsed line where it
  happened, and a tool chip opens onto the whole input. A record written before blocks existed has
  none, and keeps the flat text-with-chips rendering — its order was never captured.
  A text block goes through `ConfiguredMarkdown`, the renderer every document of the store is
  displayed with, so a reply gets what a document gets: a fenced `mermaid`, `plantuml`, `archdia`,
  `graph` or `svg` block is drawn as a diagram, and a link to a store file — `/units/abc/cadre.md` —
  resolves onto the app's mount point and opens in place through `InternalLinkNavigator`. The model
  is told both, in the system prompt worker appends to every turn
  (`operation/worker/internal/hybridflow-runner/briefing.go`); without that it writes diagram source and bare
  paths, since neither capability is visible from inside a turn.
  Each turn also carries a **permission mode**, chosen per turn in the controls row (the select is
  flagged in warning colours on `bypassPermissions`, where nothing is asked). In `manual` mode the
  service relays every tool call the CLI would prompt about, and
  [`plugins/chat/ChatPermissionRequests.tsx`](../../../../exchange/dashboard/src/plugins/chat/ChatPermissionRequests.tsx)
  renders one card per pending request above the composer — the turn stays parked until each is
  allowed or denied. **Manual Live** (`manualLive`) is that same mode with the waiting bounded: the
  card counts down to the service's own deadline (`decideAt`) and the service allows the call when
  it runs out, so a turn can be watched rather than gated, while every call is still shown and
  answering one before the count ends is what decides it. The clock is read rather than run — a
  reopened tab counts down to the same instant — and the card stands at "Allowing…" until the
  `permission_resolved` frame takes it off screen. Which mode a card
  is answered under comes from the turn's own `start`/`sync` frame rather than from the panel or
  the conversation record, both of which describe the *next* turn. The pending set is *not*
  persisted: a reload reattaches and the service replays it inside `sync`, which is what keeps a
  blocked turn answerable across a page reload.
  A running turn can also be **spoken into** rather than only watched or killed: the box stays
  usable while a turn is in flight, and Send then emits a `between` frame instead of a `prompt`.
  The service writes it to the CLI's open stdin, which folds it into the turn already in flight at
  its next tool boundary — so it steers the reply on screen rather than queueing behind it, and no
  second turn is started. It carries text alone: the model, effort and permission mode were fixed
  when the turn was spawned, and attachments belong to a message that starts one, so those controls
  stay disabled while Stop and Send are offered side by side. A between is the user's own message —
  its transcript record is `role: user` with `between: true` — and it renders as a user bubble
  captioned *said mid-turn*, above the reply it changed, which is the order the transcript reads it
  back in. A between that reached no turn (it ended in the round trip) is refused with
  `no_running_turn` and the text goes back to the box, to be sent as an ordinary prompt.
  A turn may also **ask the user a question** rather than guess — Claude Code's `AskUserQuestion` —
  and that is not a permission: what is being decided is not whether a call may run but what it
  returns. It arrives on its own frame and
  [`plugins/chat/ChatQuestions.tsx`](../../../../exchange/dashboard/src/plugins/chat/ChatQuestions.tsx) renders it as a card
  of radios, checkboxes and a free-text box per question, sending one answer string per question
  back. It appears in **every** permission mode, bypass included — a mode about which tool calls may
  run has no opinion about what the user thinks — and nothing ever answers it for the user: Manual
  Live's countdown allows a card whose answer it can guess, and a question has no such answer.
  Dismissing sends the empty answer, which tells the model the question went unanswered; leaving the
  card alone parks the turn, which is the other honest choice. Rate-limit
  display is the Usage tab beside the Conversations one —
  [`plugins/chat/ChatUsageTab.tsx`](../../../../exchange/dashboard/src/plugins/chat/ChatUsageTab.tsx), one section per agent
  with its own refresh over the gauges of
  [`plugins/chat/ChatUsagePanel.tsx`](../../../../exchange/dashboard/src/plugins/chat/ChatUsagePanel.tsx). Nothing is read
  until a refresh is pressed, and what it records lives in the app-level
  [`ChatUsageProvider`](../../../../exchange/dashboard/src/plugins/chat/ChatUsage-ctx.tsx), so every surface showing an
  account reads the same figures. Gated by `chatEnabled`.
  [`plugins/chat/ChatLoginPanel.tsx`](../../../../exchange/dashboard/src/plugins/chat/ChatLoginPanel.tsx) signs the
  *server-side* CLI in when [`useChatAuth.ts`](../../../../exchange/dashboard/src/plugins/chat/useChatAuth.ts) reports the
  host signed out: the service hands back the CLI's authorisation URL, the user approves it and
  pastes the code the page shows, and the CLI — parked on its stdin in between — completes the
  exchange. It renders nothing at all when the host is signed in or its status unreadable, and
  offers no button where the service withholds the endpoints (`loginEnabled`).

A panel should load **on first reveal, not on mount**: a bar keeps a tab rendered once it has been
shown, and each main view mounts its own bars, so an on-mount load means a request per page
load — twice — for a panel nobody has opened.
