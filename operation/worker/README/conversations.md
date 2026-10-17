# Conversations and turns

← [worker](/operation/worker/README.md) · assumes the index and [Endpoints](/operation/worker/README/endpoints.md).

**Conversation registry** (`hybridflow-runner/conversations.go`, `hybridflow-runner/handlers_conversations.go`,
`hybridflow-runner/turn_trace.go`). One directory per
conversation, holding a small `meta.json` rewritten atomically at each turn boundary, an
append-only `transcript.jsonl` beside it, and a `turns/` directory holding one trace per turn — the
operational half of a turn (how the process was run, its stderr, and on request the raw protocol),
kept out of a transcript that is read as a conversation. Splitting the two is what keeps the write budget flat — a
turn costs one appended line and one metadata rewrite whatever the reply's length, because streaming
is accumulated in memory by the hub and written once. The store knows nothing about running
processes: whether a turn is live is only ever known in memory, it belongs to `ClaudeHub`, and the
two are joined at the handler. A conversation id is a path segment, so it is validated by *shape*
(`conv-<millis>-<4 hex>`) before it can reach `filepath.Join`. At startup, any conversation whose
metadata still says a turn was running is settled with an `interrupted` record — the process died
with the service that spawned it, and nothing else would ever close that turn.

**Forking a conversation** (`POST /hybridflow-runner/conversations/{id}/fork`). A copy that carries on from a
*point* in the source: the same folder and settings, the transcript down to that point, and the same
CLI session picked up in the same place — which is what makes it a conversation Claude *remembers*
rather than a fresh chat with someone else's history above it. The point is `fromMessageId`, and the
copy stops **short** of it: forking is asked of a prompt, and the prompt itself is the one the user
is about to ask again, differently. Omitting it forks the conversation whole. The source is not
touched at all, and that is the point: it is how a second direction is tried without spending the
first one. Two conversations may not write one CLI session, so the fork gives way — it is marked
`forkPending`, and its first turn is spawned with `--fork-session`, which replays the session it was
handed and carries on under an id of its own. The marker is cleared the moment the CLI announces that
id, and cleared just as surely when the resume is refused, since there is then nothing left to branch
from. A turn running in the source is a `409`: the reply still being written would land in one
conversation and not the other.

Cutting the transcript is not cutting the session, so every assistant record carries a
`sessionAnchor` — the uuid the CLI gave that turn's last message — and a fork branching at a point
spawns with `--resume-session-at=<the last anchor it kept>`. The session then stops exactly where the
copied transcript does. A fork from a point with no reply behind it has nothing to anchor to and
takes no session at all: its history is readable and not remembered, which the fork notice says
outright.

**A turn's working directory** (`hybridflow-runner/claude_folder.go`). A conversation's folder is where its CLI process
starts, and it is re-resolved before every turn — a folder renamed or deleted since refuses the turn
with `bad_folder` rather than starting a process in whatever the service's own working directory
happens to be. Resolution is stricter than the storage layer's: symlinks are followed and the result
re-checked against the store root, because a store symlink pointing outside would otherwise put the
CLI outside it with a path that passes the lexical test.

It is a **scope, not a sandbox**. The whole store root is handed to the CLI as `--add-dir`, so a turn
started in one folder reaches every other without asking — the store is one tree and the work crosses
it — and beyond the store, `Read` and `Bash` take absolute paths and reach whatever the service user
can. Nothing here is granular: containment is the permission mode and the human answering it.

**Claude turn lifecycle** (`hybridflow-runner/claude_ws.go`, `hybridflow-runner/driver.go`, `hybridflow-runner/driver_claude.go`, `hybridflow-runner/driver_codex.go`, `hybridflow-runner/driver_muse.go`, `hybridflow-runner/driver_opencode.go`, `hybridflow-runner/claude_ws_fanout.go`, `hybridflow-runner/claude_ws_conn.go`). A turn is one
CLI process — `claude`, `codex exec`, `muse serve` or `opencode run`, whichever agent the conversation is bound to — keyed in
memory by that conversation. `/ws/hybridflow-runner` is one long-lived
socket per browser tab multiplexing every conversation that tab watches, so nothing there may assume
a socket belongs to a turn or that a turn has a socket: a turn keeps running, keeps parking on an
unanswered permission request and keeps writing its transcript with nobody connected, and a socket
that disconnects drops its subscriptions and touches no turn. One turn per conversation — a second
prompt is refused, never a replacement — and at most `KIAO_WORKER_HYBRIDFLOW_RUNNER_MAX_TURNS` (4) across
all of them. A settled turn is retained for 30 min so a `subscribe` arriving just after it ended is
still answerable, then swept by a janitor every 5 min; delivering `done` no longer evicts it, because
with several subscribers the first collector would take the turn away from the rest. An interrupted
turn keeps its execution reservation and capacity until its driver has closed its stream, even when
the interruption arrived during spawn. The janitor cannot evict that reservation. Shutdown refuses
new reservations and also stops drivers whose spawn returns after shutdown began.

**Codex process ownership** (`hybridflow-runner/agent_process_linux.go`). A Linux subreaper owns
each turn's local descendants until they are all reaped, including tools that leave the initial
process group. Cancellation, launcher exit and worker death trigger that cleanup. Work handed to
an independent manager, such as remote systemd, keeps running. The mechanism, its scope and
verification are recorded in [decision 00070](/docs/architecture/decisions/00070-codex-process-ownership.md).

**Agents** (`hybridflow-runner/agents.go`, `hybridflow-runner/driver_codex.go`, `hybridflow-runner/driver_muse.go`, `hybridflow-runner/driver_opencode.go`, `hybridflow-runner/muse_msp.go`). A conversation runs on one agent, bound at
creation like its folder and for a stronger reason: a session id belongs to one engine, so a
conversation that changed agent would hold a session nothing could resume under a transcript
claiming it had been continued. Changing agent is therefore a **fork** — `POST
/hybridflow-runner/conversations/{id}/fork` with an `agent` — which copies the transcript as a preamble, starts
a session of its own, and says so in the notice at the fork point. Four agents are implemented:
`claude`, the default, `codex`, `muse` and `opencode`, each offered where its CLI is installed. Codex publishes
`bypassPermissions` and nothing else, because `codex exec` has no approval channel at all, and OpenCode
is the same for the same reason — `opencode run` auto-rejects without `--auto`; Muse
publishes all three modes, because `muse serve` asks over its own wire. A mode an
agent does not have is refused at creation, at patch, at the prompt (`mode_unsupported`) and on a
board card. See [PROTOCOL.md § Agents](/operation/worker/PROTOCOL/agents.md).

**Claude permissions** (`hybridflow-runner/claude_ws.go`, `hybridflow-runner/driver_claude.go`). A turn runs in one of
three modes. `bypassPermissions` spawns the CLI with `--dangerously-skip-permissions`, as it always
did — unless `KIAO_WORKER_HYBRIDFLOW_RUNNER_BYPASS_ENABLED=false` withdraws the mode, which drops it from
`/hybridflow-runner/options`, refuses it on both conversation endpoints and on the socket (`bypass_disabled`),
and makes `manual` the mode an omitted one resolves to. `manual` adds `--permission-mode manual`,
which makes the CLI ask over the SDK control protocol instead of auto-denying: each ask becomes a
`permission_request` on the socket and the client's answer becomes a `control_response` on the CLI's
stdin. `manualLive` spawns exactly what `manual` spawns and is relayed the same way, with a clock on
it: a card nobody answers within ten seconds is allowed **here** (`autoAllow`), and the frame
carries the deadline so a connected tab can count it down and refuse before it. The countdown used
to be the browser's, which made the mode a promise only a watched tab could keep — a played flow
node whose chat was not on screen parked on its first tool call. Every mode reads stream-json input
and keeps stdin open for the turn — see [PROTOCOL.md § Permissions](/operation/worker/PROTOCOL/turn-control.md) for what that implies about a
parked turn. Acting on a turn (`stop`, `permission_decision`, `question_answer`) is refused for a
user who does not own it; subscribing and reading stay open.

**Questions** (`hybridflow-runner/claude_ws.go`, `hybridflow-runner/driver_claude.go`). `--permission-prompt-tool stdio` is on *every* turn, bypass included,
because a CLI with nowhere to ask does not offer the model `AskUserQuestion` at all. That tool is how
a turn puts a question to the user instead of guessing, and it reaches the browser on its own frame
(`question_request`), structured for a card rather than as raw JSON, and comes back as
`question_answer` — an allow whose `updatedInput` carries the answers keyed by question text. It is
asked in every mode, nothing ever answers it on the user's behalf, and a bypass turn's ordinary tool
calls are unaffected: the CLI allows them before it asks about one. See [PROTOCOL.md § Questions](/operation/worker/PROTOCOL/turn-control.md).
