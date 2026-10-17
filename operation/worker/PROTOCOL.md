# worker wire protocol

The contract between `exchange/dashboard` (and any other client) and this service.

**`reference/npm/kiao-worker` holds the canonical TypeScript types** for this whole contract:
`types.ts` for the file and git DTOs, `agent-types.ts` for the agent DTOs and the WebSocket
protocol. The Go structs live in `types.go` and `hybridflow-runner/dto.go`; the WebSocket messages are
assembled inline in `hybridflow-runner/claude_ws.go` and `hybridflow-runner/claude_ws_fanout.go`. Changing a field name
here means changing it in both places.

This service is a drop-in replacement for the original Java implementation, so the JSON shapes
are fixed by history: adding endpoints and fields is fine, renaming or removing anything is not.
That rule — `ADDING-AN-ENDPOINT.md`'s "wire compatibility is sacred" — is about **this HTTP
surface**. `/ws/hybridflow-runner` is not part of it and has broken compatibility deliberately more than once;
the reasoning is stated where the socket is documented rather than left to be inferred here.

**The wire is agent-neutral, and the names say so.** It carried one agent when it was written, and
every type on it was called `Claude…`; there are four now — the `claude` CLI, `codex exec`,
`muse serve` and `opencode run` — and the third and fourth changed nothing about the shapes in this contract. What is Claude's own is the
*value* of a field (`agent: "claude"`, a model called `opus`), never the shape of one.

The paths were renamed twice — `/claude/…` to `/agents/…` with that rename, `/agents/…` to
`/hybridflow-runner/…` after it — and the two surfaces answered differently, which is the rule above
applied rather than an inconsistency:

- **HTTP is aliased.** Every endpoint in this contract is served under `/hybridflow-runner/…` *and* under the `/agents/…`
  and `/claude/…` it had before — one handler, one payload, three names. Nothing on this surface announces a
  version, so a client left on the old paths has no way of being told to move.
- **The socket moved.** `/ws/hybridflow-runner` is the path; `/ws/agent` and `/ws/claude` still answer, because
  it costs one line each and a cached bundle should not break. A client that reaches any of them is told
  `hello.protocolVersion`, and that is the mechanism: a mismatch is a reload, not a negotiation.

## Path prefixes

Clients reach the service through a proxy that strips a prefix:

| Environment | Client-side URL | Reaches |
|---|---|---|
| prod (`deploy/nginx/kiao.conf`) | `/api/files/…` | `/…` |
| prod | `/api/ws/hybridflow-runner` | `/ws/hybridflow-runner` |
| dev (`exchange/dashboard/vite.config.ts`) | `/api/files/…` | `/…` |
| dev | `/api/ws/…` | `/ws/…` |

Note that `/api/hybridflow-runner/…` is rewritten by the dev proxy but has **no nginx location in prod** —
reach the usage endpoint as `/api/files/hybridflow-runner/usage`, which resolves in both environments.
`WorkerClient.getAgentUsage()` does exactly that.

The socket is the exception, having a location of its own in both: prod proxies `/api/ws/hybridflow-runner` and,
for a bundle cached from before either rename, `/api/ws/agent` and `/api/ws/claude` as well.

## Requests and authorization

All JSON responses are `application/json`; `/git/original` and `/git/working` return
`text/plain`. Authentication is a bearer token (header, or `?access_token=` for the socket).

Authorization is a realm role. **`files_user`** reaches everything in this contract, over the whole store.
**`files_reader`** is read-only: a caller bearing it and not `files_user` may call only
`GET /getFile`, `GET /list`, `GET /listRecursive`, `GET /info` and `GET /search`, and only for a
`path` under one of the store prefixes the deployment configured (`KIAO_WORKER_READER_ROOTS`,
`units` by default). Every other route, method or path — and a request naming no `path` at all — is
`403`. The request and response shapes of those five are the same for both roles; the role decides
what may be asked, never what an answer looks like.

## Topics

The socket breaks compatibility deliberately and says so with `hello.protocolVersion`: a client built against another number stops and tells the user to reload instead of negotiating. The bump rule lives with the [socket frames](/operation/worker/PROTOCOL/socket-frames.md).

### [Files](/operation/worker/PROTOCOL/files.md)
Read when: working with file, folder, or disk endpoints.
Every file and folder call: listing, reading with resume, uploading, moving, copying, deleting with link fixes, and the duplicate and size reports with deduplication.

### [Document indexes and search](/operation/worker/PROTOCOL/search-indexes.md)
Read when: touching document conversion, reindexing, or search.
How binary documents become searchable siblings, when an index is written or left alone, how to reindex a path, and the query language search understands.

### [Staging and the import gate](/operation/worker/PROTOCOL/staging-import.md)
Read when: working on uploads, review flows, or sensitive-data rules.
Uploading into a hidden staging area, reviewing and importing from it, and the seeded import-gate rules Dashboard runs in the browser over every imported text.

### [Config documents and git](/operation/worker/PROTOCOL/config-git.md)
Read when: persisting UI state, switching runners, or working on version control.
The four JSON documents Dashboard keeps outside content, where they live and what saving one triggers, plus the git surface: status, staging, commit, push, pull and consolidate.

### [File actions, media and the toolbox](/operation/worker/PROTOCOL/actions-media-toolbox.md)
Read when: adding a file action, cutting video segments, or managing installs and MCP servers.
Running provider-routed file actions, saving a video's segments with ffmpeg, and the toolbox panel: installable runtimes and MCP servers, registration, and async job polling.

<!-- stale PROTOCOL.md#agents links land here; the section now lives in this file -->
<a id="agents"></a>
### [Agent endpoints and agents](/operation/worker/PROTOCOL/agents.md)
Read when: working on the agent dropdown, quota display, model lists, or sign-in.
Which agent CLIs a deployment offers and what each one can do, the usage windows and options endpoints, and how the host's CLI is signed in from the panel.

### [Agent attachments and conversations](/operation/worker/PROTOCOL/conversations.md)
Read when: working on chats, attachments, or session branching.
Attaching files to a turn, and conversations: the durable thread a turn belongs to, its fixed folder and agent, patchable defaults, archiving, and forking with or without the session.

### [Playing a board](/operation/worker/PROTOCOL/chain-runs.md)
Read when: touching chain-run endpoints, the run list UI, or board marking.
How a board is played without a browser: starting a run on a card, what each card type does, how usage limits and retries wait, and how answers are filed and marked.

### [Socket frames](/operation/worker/PROTOCOL/socket-frames.md)
Read when: opening the socket, routing frames, or resyncing after reconnect.
The tab socket's mechanics: frame classes and routing, every client and server frame, the turn flows with their contractual orderings, and subscriptions that never own a turn.

### [Turn replies and refusals](/operation/worker/PROTOCOL/turn-replies.md)
Read when: rendering replies, background work, or handling refusals.
A reply as an ordered block list with delegations beneath it, why thinking blocks are empty, the background roster, and every refusal code a client branches on.

<!-- stale PROTOCOL.md#manual-live links land here; the section now lives in this file -->
<a id="manual-live"></a>
<!-- stale PROTOCOL.md#between links land here; the section now lives in this file -->
<a id="between"></a>
<!-- stale PROTOCOL.md#questions links land here; the section now lives in this file -->
<a id="questions"></a>
<!-- stale PROTOCOL.md#withdrawing-bypass links land here; the section now lives in this file -->
<a id="withdrawing-bypass"></a>
### [Driving a turn](/operation/worker/PROTOCOL/turn-control.md)
Read when: answering permission cards, interrupting turns, or changing modes.
Driving a turn: permission relay with manual and manual-live, saying something mid-turn, asking the user questions, withdrawing bypass, and the turn lifecycle from spawn to sweep.
