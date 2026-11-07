# Turn replies and refusals

← [worker wire protocol](/operation/worker/PROTOCOL.md) · assumes [socket frames](/operation/worker/PROTOCOL/socket-frames.md).

## Blocks

A reply is **a list of blocks in the order the model produced them** — a paragraph, a stretch of
reasoning, a tool call, another paragraph — and the order is the contract. It is only ever in the
CLI's own content array, so it is captured where that array is read and carried unchanged from
there: a client renders blocks in index order and never sorts, groups or hoists them.

| `kind` | Fields | Meaning |
|---|---|---|
| `text` | `text` | What the model said. |
| `thinking` | `text` | Where the model stopped to reason. **`text` is normally empty** — see below. |
| `tool_use` | `name`, `input?`, `detail?`, `toolUseId?`, `result?`, `isError?`, `exitCode?` | A tool call: the 80-char chip summary, the whole input cut at 4000 characters — and what the call returned, cut at 8192, with whether that was an error and the exit status when the agent gave one. |
| `subagent` | `text`, `subagent?` | A delegation: work the turn handed to a subagent. `text` is the parent's summary line, and `subagent` is what the child thought and did — see below. |

Blocks are numbered per turn and addressed by index rather than by arrival, so a client fills a gap
rather than closing it: a frame that went missing must not shift every block after it by one.

**A delegation carries its child's transcript.** A turn that hands work to a subagent files the
delegation where it happened — the parent's summary line as the block's own `text` — with what the
child thought and did beneath it: the metadata (`subagentId`, `childSessionId`, `role`,
`objective`, `status`, `result`, `durationMs`, `truncated`) and the child's own `blocks`, in the
order it produced them, with its nested delegations the same way. Each agent reads its own: the
shape is the wire's, and what fills it is one engine's transcript of its child. `truncated` is a
transcript that is not whole, cut at capture or at the record's own caps on the way to disk — the
same two budgets the turn's own blocks draw on, spent where the delegation stands.

**The CLI does not disclose the model's reasoning.** A thinking block arrives as
`{"type":"thinking","thinking":"","signature":"<opaque>"}`, and the `thinking_delta`s that stream it
are empty as well; only the signature and an `estimated_tokens` count carry anything. So a `thinking`
block here marks *that* the model thought and *where* in the turn, and almost never what it thought.
It is kept for exactly that: the shape of a turn — reasoned, called a tool, reasoned again, answered
— is most of what an audit is after, and dropping the block for having no text would take it off the
screen. `text` is read all the same, so a CLI that does disclose the reasoning needs no change here.

**An `assistant` event announces blocks that are finished, and announces each of them once.** With
`--include-partial-messages` the CLI emits one such event per completed content block — several per
message, each carrying a single-element content array and all of them sharing one message id — and
the growth of a block still in progress travels as `stream_event`, which this service does not read.
So a block is never re-sent and an `output` delta is only ever a whole block. Reading two of those
events as one block re-emitted — keying a block on its position within its message, which is always
`0` — would fold a reply into the reasoning that preceded it. That assumption, in its earlier form
of one text measured against everything the turn had said, is what used to drop the reply following a
tool result whenever it was shorter than what came before it.

The same shape is what a transcript record stores and what `GET /hybridflow-runner/conversations/{id}` reports
as `blocks`. That endpoint's `text` and `tools` are **derived** from them — `text` being what the
model *said*, thinking excluded — so the HTTP surface stayed additive. A record written before
ordered blocks existed has no `blocks` at all: its order was never captured, and the service does not
invent one.

The transcript keeps the turn around the reply as well as the reply itself. Every record of a turn —
the prompt that started it, the betweens said into it, the reply that settled it — carries its
`turnId`, which is what joins a record to the log lines written while it ran. A **between** carries
`afterBlocks`: how many of the reply's blocks had arrived when it was said. An **assistant** record
carries when the turn ran (`startedAt`, `finishedAt`, `durationMs`), how long its first block took
(`firstBlockMs`), why it ended (`endReason`, with `terminal` for a Muse turn's own word beside its
synthesised exit code), what it cost (`usage`, in the agent's own figures), and everything it parked
on (`asks`, each with its outcome and who decided it). A **user** prompt carries what the model was
actually sent (`composedPrompt`, `systemPrompt`) and — where a board played the turn — the standing
instructions and the play itself (`instructions`, `playedBy`, `agentRef`, `runId`, `flowNodeId`,
`board`), which the reply repeats so either record joins to the board without the other.

A **user** record carries one field of its own, `attachments`: the `AgentAttachmentDto`s the prompt
was sent with, in the order they were attached. It is recorded rather than derived from the ids,
because the files are swept after a month while the transcript is kept — the message is history, the
file was working material.

Every refusal is one `error` frame, and a client branches on `code` rather than on the message text
(which is only ever the sentence a human reads):

| `code` | Meaning |
|---|---|
| `unknown_conversation` | No such conversation, or it was deleted meanwhile. |
| `conversation_busy` | A turn is already running in it; a second prompt never replaces one. |
| `bad_folder` | The folder no longer exists, is a file, or escapes the store root. |
| `unknown_permission_mode` | A mode this service cannot drive over the socket. |
| `unknown_agent` | The conversation is bound to an agent this deployment no longer offers. Its session belongs to that engine and cannot be moved, so the way on is to fork it onto another agent. |
| `mode_unsupported` | The mode is a real one, and the conversation's **agent** does not have it — asking Codex for `manual`, say. See [Agents](/operation/worker/PROTOCOL/agents.md#agents). |
| `bypass_disabled` | `bypassPermissions` was asked for — on the frame, or by the conversation it would be inherited from — on a service that does not allow it. |
| `too_many_turns` | The concurrent-turn cap was reached. |
| `bad_attachment` | An attachment the prompt named is gone or was never uploaded, or the message carries more than ten. The turn is refused rather than run without the file. |
| `spawn_failed` | The `claude` process could not be started, or the prompt could not be recorded. |
| `not_permitted` | The caller does not own the running turn they tried to act on. |
| `no_running_turn` | A `between` reached no turn: there was none, or its pipe had closed in the moment it took to send. Nothing was said to the agent, so the message is still the sender's — it goes back to the box, and the conversation is idle enough to take it as a prompt. |
| `cli_error` | The CLI emitted an `error` event mid-turn. |
| `not_signed_in` | The agent refused for want of credentials — a turn that never ran because the host is signed out. Not a mid-turn complaint: the panel answers it with the sign-in the Usage tab offers. |

An `error` reaches **every** subscriber of the conversation, not only the tab that caused it: the
conversation is shared, and leaving the others showing a turn that never started would be worse than
telling them about a refusal they did not ask for.

## Background work

A turn that delegates reads as a wait with no breakdown unless somebody reports the work it handed
off: the drain's notice names a count and nothing beneath it, so a workflow parked on children
nobody can see looks exactly like one still working. The roster is that breakdown — the drain's
inventory made visible. Each `background` frame carries it whole, in first-sight order, finished
tasks kept: one row per workflow, delegation and backgrounded tool call, with a workflow's folded
children beneath it.

A row carries the host's words and this service's lane side by side. `status` is the most telling
word the host gave — the fine-grained control status while the task is out (`running`,
`resultReady`, `manualReconciliation`), the generic verdict once it has landed (`completed`,
`failed`, `cancelled`) — and `state` is the lane that word counts in: `running` is work still
out, `waiting` work parked on its owner, `finished` work that landed. `waiting` is the one lane
that is neither: a delegation the host quarantined ended without a result this service could
reconcile on its own, and it moves again only when somebody tells the agent what to do with it —
counting it running would be the wait that never ends, and counting it finished a verdict nobody
gave. A lane a client has never heard of is shown under its verbatim word and counted nowhere.

The turn's end settles the roster on both sides of the socket, without a further frame: whatever
is still open is marked finished-and-`abandoned`, in the service's own word. The hub settles the
turn it holds, so a resync replays the wait as over; a connected tab settles the turn it renders,
on `done`, `stopped` and any refusal nothing was spawned for. A roster event for a turn that has
ended is then a straggler, and is dropped like any other. An agent that tracks no background work
sends no roster events, and the roster stays empty.
