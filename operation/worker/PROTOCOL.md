---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# worker wire protocol

The contract between `exchange/dashboard` (and any other client) and this service.

**`reference/kiao-worker` holds the canonical TypeScript types** for this whole contract:
`types.ts` for the file and git DTOs, `harness-types.ts` for the harness DTOs and the WebSocket
protocol. Go request and response models live beside their owning capabilities under
`internal/files`, `internal/hybridflow-runner` and `internal/toolbox`. Socket framing lives in
`internal/hybridflow-runner/http`, with event routing under `internal/hybridflow-runner/turns/events`.
Keep the client types and Go models in agreement when changing the contract.

**Preserve HTTP compatibility:** add endpoints and fields without renaming or removing existing
ones. The [endpoint guide](ADDING-AN-ENDPOINT.md) describes the implementation checks.
The WebSocket uses `hello.protocolVersion`; its [versioning rule](PROTOCOL/socket-frames.md)
requires a client with a mismatched version to stop and request a reload.

**The wire is harness-neutral.** Claude, Codex, Muse, OpenCode and Pi share the same message
shapes. The `harness` field and model names identify the engine-specific values.

Runner HTTP endpoints under `/hybridflow-runner/…` also accept `/harnesses/…` and `/claude/…`
as compatibility aliases, with the same handlers and payloads. The socket accepts
`/ws/hybridflow-runner`, `/ws/harness` and `/ws/claude`; every path uses the same protocol version.

## Path prefixes

Clients reach the service through a proxy that strips a prefix:

| Environment | Client-side URL | Reaches |
|---|---|---|
| prod (`bin/docker/kiao-image/kiao.conf.template`) | `/api/files/…` | `/…` |
| prod | `/api/ws/hybridflow-runner` | `/ws/hybridflow-runner` |
| Vite (`exchange/dashboard/vite.config.ts`) | `/api/files/…` | `/…` |
| Vite | `/api/ws/…` | `/ws/…` |

`/api/hybridflow-runner/…` is rewritten by the Vite proxy but has **no nginx location in prod** —
reach the usage endpoint as `/api/files/hybridflow-runner/usage`, which resolves in both environments.
`WorkerClient.getHarnessUsage()` does exactly that.

The socket has its own proxy location: production accepts `/api/ws/hybridflow-runner` and
the compatibility aliases `/api/ws/harness` and `/api/ws/claude`.

## Requests and authorization

All JSON responses are `application/json`; `/git/original` and `/git/working` return
`text/plain`. Authentication is a bearer token (header, or `?access_token=` for the socket).

In production, **`files_user`** is the sole realm role granting access to this contract, over the
whole store. All applications, including listening clients, use the owner's account. A valid JWT
without `files_user` gets `403`, including one bearing only `files_reader`; missing, invalid or
expired credentials get `401`. JWT signature, issuer and expiry validation applies before the
role check. Per-turn callback credentials retain their registry-based authentication.

The same account has full access from every application, over HTTP and WebSocket; the
operations a client presents do not define a separate authorization scope. See the
[access decision](/docs/solution-design/decisions/00068-owner-access-from-every-application.md).

Path bounds, state-directory protection, agent permissions and file-operation checks apply
independently. `GET /healthz` is an unauthenticated liveness probe.

## Topics

### [Files](/operation/worker/PROTOCOL/files.md)
Read when: working with file, folder, or disk endpoints.
Every file and folder call: listing, reading with resume, uploading, moving, copying, deleting with link fixes, and the duplicate and size reports with deduplication.

### [Document indexes and search](/operation/worker/PROTOCOL/search-indexes.md)
Read when: touching document conversion, reindexing, or search.
How binary documents become searchable siblings, when an index is written or left alone, how to reindex a path, and the query language search understands.

### [Staging and the import gate](/operation/worker/PROTOCOL/staging-import.md)
Read when: working on uploads, review flows, or sensitive-data rules.
Uploading into a hidden staging area, reviewing and importing from it, and the seeded import-gate rules Dashboard runs in the browser over every imported text.

<a id="config-documents-and-git"></a>
### [Config documents](/operation/worker/PROTOCOL/config-documents.md)
Read when: persisting UI state, changing plugins or switching runners.
The four JSON documents, allowed names, validation and save effects.

### [Git](/operation/worker/PROTOCOL/git.md)
Read when: working on version control.
Status, staging, commit, push, pull, consolidation and Git result semantics.

<a id="file-actions-media-and-the-toolbox"></a>
### [File actions](/operation/worker/PROTOCOL/actions.md)
Read when: adding a file action or integrating a provider.
Descriptors, applicability, provider routing and operation results.

### [Media](/operation/worker/PROTOCOL/media.md)
Read when: saving video segments or handling encoding jobs.
Segment validation, ffmpeg requirements, output files and job polling.

### [The toolbox](/operation/worker/PROTOCOL/toolbox.md)
Read when: managing installs, harness availability or MCP servers.
Inventory, registration and asynchronous install and uninstall jobs.

<a id="agents"></a>
### [Workflow agents and harnesses](/operation/worker/PROTOCOL/harnesses.md)
Read when: working on the harness dropdown, quota display, model lists, or sign-in.
Which harness CLIs a deployment offers and what each one can do, the usage windows and options endpoints, and how the host's CLI is signed in from the panel.

### [Harness attachments and conversations](/operation/worker/PROTOCOL/conversations.md)
Read when: working on chats, attachments, or session branching.
Attaching files to a turn, and conversations: the durable thread a turn belongs to, its fixed folder and harness, patchable defaults, archiving, and forking with or without the session.

### [Playing a board](/operation/worker/PROTOCOL/chain-runs.md)
Read when: touching chain-run endpoints, the run list UI, or board marking.
How a board is played without a browser: starting a run on a card, what each card type does, how usage limits and retries wait, and how answers are filed and marked.

### [Socket frames](/operation/worker/PROTOCOL/socket-frames.md)
Read when: opening the socket, routing frames, or resyncing after reconnect.
The tab socket's mechanics: frame classes and routing, every client and server frame, the turn flows with their contractual orderings, and subscriptions that never own a turn.

### [Turn replies and refusals](/operation/worker/PROTOCOL/turn-replies.md)
Read when: rendering replies, background work, or handling refusals.
A reply as an ordered block list with delegations beneath it, why thinking blocks are empty, the background roster, and every refusal code a client branches on.

<a id="manual-live"></a>
<a id="between"></a>
<a id="questions"></a>
<a id="withdrawing-bypass"></a>
### [Driving a turn](/operation/worker/PROTOCOL/turn-control.md)
Read when: answering permission cards, interrupting turns, or changing modes.
Driving a turn: permission relay with manual and manual-live, saying something mid-turn, asking the user questions, withdrawing bypass, and the turn lifecycle from spawn to sweep.

### [Pi execution profiles](/operation/worker/PROTOCOL/pi.md)
Profiles, secrets, model capabilities, native sessions, deferred messages and Pi settlement.
