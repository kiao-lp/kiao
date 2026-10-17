# What a conversation folder holds

One directory per conversation under the state directory — `<root>/.kiao-config/conversations/`
when nothing configures it elsewhere — named `conv-<creation millis>-<4 hex>`, so a listing is
chronological. Two files and a directory, everything `0600` under `0700`:

```
.kiao-config/conversations/conv-1789362157662-8fd5/
├── meta.json         rewritten whole at every turn boundary
├── transcript.jsonl  appended, one JSON record per line
└── turns/            one trace per turn, the last 20 kept
    └── turn-1789362157901-3a1c.jsonl
```

Written by worker, `internal/hybridflow-runner/conversations.go`. The folder is the only copy:
hybridflow-store keeps the boards and names a card's chat by its id, but the transcript itself
lives here and nowhere else.

## meta.json

| field | what it is |
| --- | --- |
| `schemaVersion` | `1`. A reader accepts any version it can parse. |
| `id` | the directory name, repeated |
| `title`, `titleSetByUser` | first non-empty line of the first prompt, collapsed and cut at 60 runes, unless a person renamed it |
| `folder` | the CLI's cwd, relative to the store root; fixed at creation |
| `agent` | `claude`, `codex`, `muse`…; fixed at creation |
| `owner` | `anonymous` when unauthenticated |
| `model`, `effort`, `permissionMode`, `thinking` | the settings the **last** turn ran with |
| `sessionId` | the agent's own session, handed back as `--resume` |
| `sessionLost` | the agent refused that resume; the next turn starts fresh |
| `forkPending`, `forkAnchor` | `sessionId` belongs to another conversation, to be replayed with `--fork-session` from that message |
| `archived`, `pinned` | display state, kept server-side so it follows the user between tabs and machines |
| `messageCount` | records a reader will actually be served — compaction adjusts it |
| `createdAt`, `updatedAt` | RFC3339, fixed 3-digit millis, so string order is chronological |
| `runningAt` | set at spawn, cleared at settle. Never sent to a client: liveness is the in-memory turn registry's answer. Its only job is to let startup find a turn the service was killed inside. |
| `lastExitCode` | the process exit code of the last turn, `null` before the first |
| `traceStream` | keep the raw protocol in this conversation's [turn traces](#turnsturn-idjsonl). Off by default, and the only part of a trace that is switched. |

## transcript.jsonl

One record per line, in three roles: `user` (what was typed), `assistant` (a whole reply as one
record), `notice` (a line the service wrote itself — a fork point, a trimmed transcript, an expired
session).

| field | on which record | what it is |
| --- | --- | --- |
| `id`, `at` | all | `msg-<millis>-<4 hex>`, and the time that record was **written** |
| `text` | user, notice | the prompt verbatim; empty on a current assistant record |
| `between` | user | said *into* a running turn rather than starting one |
| `attachments[]` | user | `id`, `name`, `size`, `mediaType` — the metadata, never the bytes |
| `blocks[]` | assistant | the reply in the order the model produced it |
| `tools[]` | assistant | legacy: records written before `blocks` existed carry `text` + `tools` and no order |
| `model`, `effort`, `permissionMode` | user, assistant | what that turn ran with, in case the conversation has since changed |
| `exitCode`, `interrupted` | assistant | the process's own verdict; `interrupted` also marks a turn settled by a stop or by startup |
| `truncated` | any | a cap was hit and something was dropped from this record |
| `sessionAnchor` | assistant | the agent's id for the last message of the turn — a Claude message uuid, a Muse turn id — which is what makes forking *from a point* possible |

A block is one of three kinds:

| `kind` | carries |
| --- | --- |
| `text` | `text` — what the model said |
| `thinking` | `text` — the reasoning. A redacted block carries none, and is kept anyway: that the model thought here is the record. |
| `tool_use` | `name`, `input` (the 80-char chip label), `detail` (the whole input as indented JSON, cut at 4000 runes) |

### Cadence

A turn is exactly two writes, whatever its length: the user's record **before** the spawn — which is
what leaves an interrupted turn something to close at the next startup — and the whole reply after
the exit. Streaming is accumulated in memory and never touches the disk. One extra metadata rewrite
happens when the agent announces its session id, so a machine that dies mid-turn still has something
to resume. A `between` is a third write, filed after the prompt and before the reply.

### Caps

| cap | value | what crossing it costs |
| --- | --- | --- |
| transcript | 8 MiB → compacted to 4 MiB | oldest records dropped, one notice left in their place; the agent's own session keeps them |
| one record | 256 K chars | the **end** is kept, the front cut, `truncated: true` |
| tool calls per record | 500 | the newest 500 kept |
| conversations | 500 | creation is refused; nothing is ever deleted on the user's behalf |

## turns/&lt;turn id&gt;.jsonl

The operational half of a turn, which is everything the transcript beside it is right to refuse: how
the process was run, what it wrote to stderr, and — on request — the raw protocol. It would drown a
transcript that is read as a conversation, and nobody rereading a reply wants the argument list the
CLI was spawned with; but when a turn goes wrong it is the only thing that says why, and until it
existed most of it went to a pipe nobody kept.

One file per turn, named by the turn id the transcript's records carry, so a record and the lines
written while it ran join on one key. Written by worker, `internal/hybridflow-runner/turn_trace.go`.
One JSON record per line, in five kinds:

| `kind` | written by | what it is |
| --- | --- | --- |
| `run` | the hub, **before** the spawn | the turn as it was handed over: `conversation`, `turn`, `agent`, `owner`, `folder`, `workDir`, `storeRoot`, the settings, `allowBypass`, `session` / `forkSession` / `resumeAt`, `mcpServers[]`, `mcpConfig`, `mcpToken` (whether one was minted, never which), and the play — `playedBy`, `runId`, `flowNodeId`, `board`. A turn that never started still has one, which is the turn it is most worth reading for. |
| `exec` | the driver, after the process exists | `binary`, `path`, `version`, `argv`, `env`, `dir`, `pid`, `skillsPath`, `skills[]`, and `config` — a configuration staged for the turn and deleted after it. |
| `stderr` | every turn | one line the agent wrote there, whole. |
| `stream` | only where `traceStream` is on | one frame of the raw protocol, with `dir`: `out` is what the agent said, `in` what was said to it. |
| `note` | the service | something that happened to the turn: a spawn that was refused, a trace that reached its limit. |

**`exec` is per driver, because the interesting field is.** Claude's is the argument list, which
carries the model, the effort and the whole system prompt. Codex's is the argument list too, for the
same reason and one more: the `mcp_servers` table travels on it. Muse's argv says almost nothing —
`muse serve` and no more — because everything about the turn is in a `settings.json` staged in a
temporary directory and deleted on the way out with the turn's credential in it; `config` is that
file, which is otherwise the only copy and dies with the turn.

**No credential is ever written.** `mcpConfig` and `config` are kept as they were *rendered*, before
the credentials were substituted into them, so a `${VAR}` placeholder stands where a secret would.
An offered server's environment and headers keep their keys, and a value only where it is such a
placeholder — anything else reads `<set>`. On top of that the trace scrubs every secret the turn was
given out of everything it writes, whatever the shape: the Codex argument list carries the turn
token by necessity, and a call site that forgot would otherwise be the whole of it. `env` is what
this service *added* to the environment it inherited, never the environment itself.

### The switch

`stream` is the one part that is switched, per conversation, with `traceStream` on `meta.json`
(`PATCH /hybridflow-runner/conversations/{id}`, `{"traceStream": true}`). It is the whole exchange rather than
the reply, which is exactly what makes it a debugging artefact and not a transcript — and what a
driver understands becomes blocks while the rest is dropped, so this is the only place Claude's
`user` events, Codex's `item.started` / `item.updated` / `turn.started` / `turn.completed` and
Muse's unknown item kinds exist at all. It applies to the turns that follow; a trace already written
is what it was written as.

Everything else is unconditional. The `run` and `exec` records are one line each, and stderr is
bounded below — so a turn that goes wrong on a conversation nobody had switched anything on for
still says why.

### Caps

| cap | value | what crossing it costs |
| --- | --- | --- |
| one trace | 1 MiB | the file stops, with a `note` saying so. The **head** is kept, unlike the record caps above: a trace is read for how the turn was set up and what it did first, and a turn that has written a megabyte of progress notices is one whose beginning nobody has seen. |
| one record | 8 K chars | cut, ending `…[cut]`. The line no longer parses as JSON, which is how it reads as the evidence it is. |
| traces per conversation | 20 | the oldest are deleted when a new turn opens one. The transcript keeps every turn there ever was; this keeps the ones somebody might still be debugging. |

A trace is never a reason for a turn to fail: one that cannot be opened is a single `warn` in the
service log and a turn that runs exactly as it would have.

### The MCP callback traffic is not here

A turn's tools calling this service back is **traffic**, not something the model said, so it is one
attribute on the line the access log already writes for every request: `turn=<conversation>/<turn>`,
beside the `source=TURN_TOKEN` that was already there. The turn token is minted for exactly one turn
and carries its name, which is what lets a turn's trace and the requests its tools made be read
together. No second store, and the ordinary line — a browser reading a folder — is unchanged.

## What is not captured, and should be

Everything below is conversation content: a reader of this transcript needs it to understand the
turn, and all three agents hand us most of it. It is visible on the wire or in the log while it
happens, and none of it survives in the folder.

| missing | what the agent already gives us | today |
| --- | --- | --- |
| **What a tool returned** — output, exit status, error | **Claude**: a `tool_result` block on a `user` event; `readEvent` has no case for that event and `blockKind` maps that type to `""`. **Codex**: the rest of the same `item.completed` the block is already read from — `codexBlock` takes `command` off a `command_execution` and drops everything beside it. **Muse**: `museBlock` reads `tool` and `args` off a `toolCall` item and nothing else. | the transcript says a tool was called and with what. Whether it worked is not written down anywhere in this store. |
| **Why the turn ended** | **Claude**: an `error` event's message, and the CLI's own failure text composed as one last text block (which is what `blockTail` exists to read). **Codex**: `turn.failed.error.message`, and the last stderr line relayed when the stream said nothing. **Muse**: `terminal` — `completed`, `cancelled`, `failed` — with `error.message` beside it. | all three collapse to `exitCode` + `interrupted`, and the sentence is emitted to the socket and dropped. For Muse the number is synthesised from the terminal (`0`/`-1`/`1`) and is not a process exit code at all. |
| **Which turn a record belongs to** | the hub mints a turn id per turn, and every log line about that turn carries `conversation` and `turn`. | no record carries it. The log can be filtered to a conversation and never to one turn of it, so a record cannot be joined to the lines written while it ran. |
| **Tokens and cost** | **Claude**: the `result` event, which the driver reads for `is_error` and nothing else. **Codex**: `turn.completed.usage` — what one turn cost, as `codex_usage.go` says while explaining why the quota is read elsewhere. **Muse**: MSP reports per-session usage. | dropped. `GET /hybridflow-runner/usage` is a live probe of the *account*, so nothing ever says what a conversation, or a turn, spent. |
| **Timing inside a turn** | every event arrives with a clock available at each step. | two timestamps per turn, both write-times. No per-block time, no tool duration, no time to first block — and `runningAt` is cleared at settle, so the turn's own duration is gone too. |
| **Permission asks and their answers** | **Claude**: `control_request` / `can_use_tool`, withdrawn by `control_cancel_request`. **Muse**: approvals with a subject line and the choices offered, and questions with their answers. **Codex**: nothing — `codex exec` never asks, and the sandbox stands in for the human. | in `job.pending` in memory and on the socket. What was asked, what was allowed or denied, what a countdown decided: nothing on disk, so a replayed transcript shows a tool call with no sign that anyone let it through. |
| **What the model was actually sent** | the composed prompt (`promptWithContext` adds the attachment and image paths), the rendering briefing on the system prompt, and the managed agent's `Instructions`. | the record keeps the text the user typed. Three of the four things the model read are not in the store. |
| **Which managed agent played the card** | the chain runner resolves a `playAgent` per play — name, platform, model, standing instructions. | `meta.agent` is the *engine* and `meta.model` the model; the persona is not written down. hybridflow-store holds `flowNode.conversation_id` from the flow node's side, so a card names its conversation and a conversation names no card. |
| **What a fork was forked from** | `fork` has the source's id in hand when it writes the copy. | only a notice naming the source's *title* — which is neither unique nor stable, since renaming the source silently breaks the only link there is. |
| **A Muse subagent's own story** | `subagent` items carry the host's one-line summary of a turn of a turn; `workflow`, `reminderChild`, `userShell` and `compaction` items carry their own. | the summary is kept as one text block and the other four kinds are dropped, so a turn that delegated its work reads as a single line about having delegated it. |
| **Where a `between` landed in the reply** | nothing: the agents stream, and the hub accumulates. | unrepresentable. The whole reply is one record, so there is no point inside it to file a remark at; the order on disk is always prompt → betweens → reply. |
| **Block order on old records** | nothing — it was never captured. | a record with `tools[]` and no `blocks[]` predates ordering and is read exactly as written. Current records carry it; the old ones cannot be repaired by guessing. |

## What is not captured, and should not be at all

The rest already lives somewhere with a lifetime of its own, and writing it down a second time would
only buy a copy that goes stale. Nothing below asks for a new store — each row is a case of the
folder being right to stop where it does.

| missing | where it goes today | where it belongs |
| --- | --- | --- |
| **Attachment bytes** | `.kiao-config/claude-attachments/`, swept 30 days after upload and at startup only. | exactly there. The record names what was attached and keeps saying so after the bytes go, which is the truthful outcome: the message is history, the file was working material. |
| **What compaction dropped** | gone from the transcript at 8 MiB, with a notice saying how many records went. | nowhere new. The agent's own session still holds them, so the cut costs display history and never the model's memory. |
| **The whole exchange with the model** | the agent's own session, which we name but never read: Claude's `~/.claude/projects/<slug>/<sessionId>.jsonl`, the Codex thread `codex exec resume <id>` continues, the session log a Muse host leaves behind it. | exactly there. It already holds the tool results and the usage this store drops, it outlives the host that wrote it, and nothing here ever trims it. `meta.json`'s `sessionId` is the handle — which is the one thing that makes a folder worth this little readable at all. |
