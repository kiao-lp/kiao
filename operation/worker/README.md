---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# worker

The Go backend for KIAO's document store, harness execution and machine tooling.
It exposes HTTP endpoints and a WebSocket for Dashboard; the
[`kiao-worker` TypeScript client](/reference/kiao-worker/) defines the shared wire types.
See [PROTOCOL.md](PROTOCOL.md) for request and response contracts.

Two of its service families are backend halves of functional features that cut across containers.
`internal/files` is the backend half of **DCMS** — *document and content management system* —
the document management feature it forms together with the file-oriented views of
[`exchange/dashboard`](/exchange/dashboard/README.md). `internal/hybridflow-runner` is the
engine of **hybridflow** — conversations, turns, the play loop — beside the boards and
conversations UI in Dashboard and the hybridflow-store backend. All are developed, delivered
and deployed as one thing (the `kiao` Docker image, `bin/local-start-kiao.sh`, the installed
`kiao` executable). See
[`docs/solution-design/decisions/README.md`](/docs/solution-design/decisions/README.md).

The service listens on `SERVER_PORT` and never faces the browser directly: whatever fronts
it — nginx in the image, the launcher in the installed executable — routes `/api/files/` to
the worker root and `/api/ws/…` to `/ws/…` on that port.

## Runtime requirements

The worker is a self-contained static binary. `git` and `node` (for migrations and bundled
MCP servers) are required on the host PATH. Harness CLIs — `claude`, `codex`, `muse`,
`opencode`, `pi` — are optional; the service offers the installed and enabled harnesses.
A host with no harness CLI still serves its document store.

## Authorization

In production, `core/access/auth.go` validates Keycloak JWT signatures, issuer and expiry, then
requires the `files_user` realm role for every authenticated route. All applications use the
owner's account, including listening clients. A valid JWT without `files_user` gets 403, including
one bearing only the legacy `files_reader` role. Missing or invalid credentials get 401.

The [access decision](/docs/solution-design/decisions/00068-owner-access-from-every-application.md)
applies to every application; client interfaces do not restrict the owner's account rights.

Per-turn callback tokens retain their registry validation, expiry, revocation and caller identity.
Agent permissions and filesystem checks remain independent of the realm role: document paths
stay bounded, the state directory stays protected and file operations retain their checks.
`app/server.go` exposes `/healthz` as an unauthenticated liveness probe. Debug authentication
remains available for local verification.

## Error taxonomy

**Error taxonomy** (`core/errors/errors.go`, `core/http/errors.go`). Handlers never choose HTTP status codes by hand — they return an
error and call `httpkit.WriteError`, which classifies it via `httpkit.StatusForError`:

| Error | Status |
| --- | --- |
| explicit `*httpkit.HTTPError{Status, Msg}` | that status |
| any `faults.ClientError` — a caller mistake, declared with `faults.Invalid` | 400, with the whole wrapped message |
| `os.ErrNotExist` | 404 |
| anything else | 500 (message hidden as `"internal error"`, cause logged with the request id) |

The socle declares the sentinels shared by both halves (`filesystem.ErrOutsideRoot`,
`filesystem.ErrNotDirectory`, `filesystem.ErrStatePath`, `filesystem.ErrDeleteRoot`); each half declares its own the
same way (`search.ErrBadPattern` and `content.ErrCopyIntoSelf` in `files`, `conversations.ErrBadConversationID` and
`conversations.ErrBadAttachmentID` in `hybridflow-runner`). There is no list here to keep in step with them: classification
is by type, so a new sentinel needs no case anywhere.

Domain code stays HTTP-agnostic by returning the sentinels (wrapped with `%w`); only 5xx causes
are logged, and their detail is never leaked to the client. A 4xx body **is** user-facing copy:
`WorkerClient.search` puts it into `WorkerError.message` and Dashboard shows it on the search
box, so keep those messages short and actionable.

## Topics

A **harness** is Claude, Codex, Muse, OpenCode or Pi: the execution tooling behind a
conversation. A workflow **harness** selects that harness, a model and instructions; it
retains its ID and publications. See [the naming decision](/docs/solution-design/decisions/00066-harness-and-workflow-agent.md).

### [Endpoints](/operation/worker/docs/solution-design/endpoints.md)
Read when: adding or calling an HTTP endpoint.
HTTP routes, resumable downloads, compatibility aliases and the full wire contract.

<a id="request-handling--lifecycle"></a>
<a id="request-handling-and-state"></a>
### [Request lifecycle](/operation/worker/docs/solution-design/request-handling.md)
Read when: touching middleware, logging or shutdown.
The HTTP middleware chain, request tracing and graceful shutdown.

### [Operational state](/operation/worker/docs/solution-design/state.md)
Read when: changing the state directory, registries, process lock or legacy state adoption.
State isolation, atomic persistence and adoption of older layouts.

### [Store scope](/migrations/README.md#kiao-files)
Read when: changing automatic-pass exclusions or `.kiao-files` declarations.
The shared scope contract for migrations, link repair, search and delete-scope listings.

### [Config documents](/operation/worker/PROTOCOL/config-documents.md)
Read when: persisting Dashboard configuration, UI state or runner identity.
Allowed document names, JSON validation and synchronous save listeners.

### [Conversations and turns](/operation/worker/docs/solution-design/conversations.md)
Read when: working on chats, turns, harnesses, permissions, or forks.
Where conversations live on disk, how forking branches a session, how a turn runs with its harness and folder, and how permissions and questions reach the user.

### [Playing a board](/operation/worker/docs/solution-design/playing-board.md)
Read when: touching chain runs, the run list, or board marking.
How a chain run plays cards without a browser, what each card type does, how usage limits and retries wait, and how answers are filed and marked.

<a id="file-actions-and-the-toolbox"></a>
### [File actions](/docs/solution-design/partitions/dcms/file-actions.md)
Read when: adding a file action or changing provider routing.
The manifest, provider ownership and execution sequence across DCMS.

### [The toolbox](/operation/worker/docs/solution-design/toolbox.md)
Read when: installing runtimes and MCP servers or selecting turn equipment.
Catalogue recipes, installation ownership and runtime resolution.

<a id="configuration"></a>
### [Configuration](/operation/worker/docs/solution-design/configuration.md)
Read when: deploying the service or changing an environment variable.
Deployment environment variables, defaults and validation, supported aliases, and migration sources and their baseline.

<a id="build--run"></a>
<a id="code-map"></a>
### [Build, run and code map](/operation/worker/docs/solution-design/build-code-map.md)
Read when: building the binary, running tests, or finding which file owns what.
How to build the static binary and run the service locally, the package hierarchy, dependency boundaries, resource ownership and the tests for each responsibility.
