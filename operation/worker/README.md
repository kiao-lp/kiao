# worker

A Go reimplementation of the KIAO REST file store — formerly a Java/Spring Boot service in
this same directory, since removed. It started out wire-compatible with the
original: same HTTP endpoints, same JSON shapes, same query/multipart parameters, and the **same
environment variables**, so it was a drop-in replacement behind nginx and for the `kiao-worker`
TypeScript client. `/search` has since been taken beyond that parity on purpose (see [Deviations](/operation/worker/README/deviations.md)); everything else still holds. Many source files still name their Java counterpart (e.g.
`kiao.worker.FileStorageService`) to make the parity auditable.

Two of its libraries are backend halves of functional features that cut across containers.
`internal/files` is the backend half of **DCMS** — *document and content management system* —
the file and content management feature it forms together with the file-oriented views of
[`exchange/dashboard`](/exchange/dashboard/README.md). `internal/hybridflow-runner` is the
engine of **hybridflow** — conversations, turns, the play loop — beside the boards and
conversations UI in Dashboard and the hybridflow-store backend. All are developed, delivered
and deployed as one thing (the `kiao` Docker image, `bin/local-start-kiao.sh`, the installed
`kiao` executable). See
[`docs/architecture/decisions/README.md`](/docs/architecture/decisions/README.md).

The service listens on `SERVER_PORT` and never faces the browser directly: whatever fronts
it — nginx in the image, the launcher in the installed executable — routes `/api/files/` →
`:18080/` and `/api/ws/hybridflow-runner` → `:18080/ws/hybridflow-runner`.

## Why Go

Self-contained static binary (no JRE), faster start-up, smaller memory footprint. `git` and `node`
(for migrations) are still required on the host PATH, exactly as before. An agent CLI — `claude`,
`codex`, `muse`, `opencode` — is not *required*: the service offers whichever of them is on the PATH when it is asked,
so a host with neither serves its store and reports an agent tab with nothing to run, rather than
refusing to start.

## Authorization

**Authorization** (`core/auth.go`, `server.go`). Two realm roles, and the split is what each is *for*.
`files_user` is the editing role: it reaches every route, over every path, and is what Dashboard and
the MCP servers hold. `files_reader` is read-only, and is what a listening client — one
downloading files without editing — is given instead. A caller bearing it and not `files_user` may
reach only the routes in `readerRoutes`, the allowlist that sits beside the mux it mirrors
(`GET /getFile`, `/list`, `/listRecursive`, `/info`, `/search`), and only for paths under one of the
prefixes in `KIAO_WORKER_READER_ROOTS` — `units` by default. Anything else is 403: another
route, another method, a path outside the roots, or no path at all, which is what keeps a listing of
the store root out of reach. The requested path is normalised before it is matched, so traversal out
of a root lands where it really points and matches nothing. Both halves of the decision are data —
the routes beside the routing, the roots in the environment — so a new endpoint is invisible to the
read-only role until someone adds it to the list on purpose.

## Error taxonomy

**Error taxonomy** (`core/errors.go`). Handlers never choose HTTP status codes by hand — they return an
error and call `core.WriteError`, which classifies it via `core.StatusForError`:

| Error | Status |
| --- | --- |
| explicit `*core.HTTPError{Status, Msg}` | that status |
| any `core.ClientError` — a caller mistake, declared with `core.Invalid` | 400, with the whole wrapped message |
| `os.ErrNotExist` | 404 |
| anything else | 500 (message hidden as `"internal error"`, cause logged with the request id) |

The socle declares the sentinels shared by both halves (`core.ErrOutsideRoot`,
`core.ErrNotDirectory`, `core.ErrStatePath`, `core.ErrDeleteRoot`); each half declares its own the
same way (`errBadPattern` and `errCopyIntoSelf` in `files`, `errBadConversationID` and
`errBadAttachmentID` in `hybridflowrunner`). There is no list here to keep in step with them: classification
is by type, so a new sentinel needs no case anywhere.

Domain code stays HTTP-agnostic by returning the sentinels (wrapped with `%w`); only 5xx causes
are logged, and their detail is never leaked to the client. A 4xx body **is** user-facing copy:
`WorkerClient.search` puts it into `WorkerError.message` and Dashboard shows it on the search
box, so keep those messages short and actionable.

## Topics

<!-- stale README.md#endpoints-parity-with-the-java-service links land here; the section now lives in this file -->
<a id="endpoints-parity-with-the-java-service"></a>
### [Endpoints](/operation/worker/README/endpoints.md)
Read when: adding or calling an HTTP endpoint.
Every HTTP route the service answers, which ones keep Java parity and which ones do not, how downloads resume, and where the full wire contract lives.

<!-- stale README.md#request-handling--lifecycle links land here; the section now lives in three files: request handling, conversations, playing a board -->
<a id="request-handling--lifecycle"></a>
### [Request handling and state](/operation/worker/README/request-handling.md)
Read when: touching middleware, logging, shutdown, or anything under the state directory.
Middleware, logging and shutdown around every request, what the service owns outside content, which files declare content, and how the previous layout is adopted.

### [Conversations and turns](/operation/worker/README/conversations.md)
Read when: working on chats, turns, agents, permissions, or forks.
Where conversations live on disk, how forking branches a session, how a turn runs with its agent and folder, and how permissions and questions reach the user.

### [Playing a board](/operation/worker/README/playing-board.md)
Read when: touching chain runs, the run list, or board marking.
How a chain run plays cards without a browser, what each card type does, how usage limits and retries wait, and how answers are filed and marked.

<!-- stale README.md#file-actions links land here; the section now lives in this file -->
<a id="file-actions"></a>
<!-- stale README.md#the-toolbox links land here; the section now lives in this file -->
<a id="the-toolbox"></a>
### [File actions and the toolbox](/operation/worker/README/actions-toolbox.md)
Read when: adding a file action or installing runtimes and MCP servers.
How file actions route to providers through a manifest, what the toolbox may install without root, and which servers and agent CLIs a turn is handed.

<!-- stale README.md#configuration links land here; the section now lives in this file -->
<a id="configuration"></a>
### [Configuration](/operation/worker/README/configuration.md)
Read when: deploying the service or changing an environment variable.
Every environment variable the service reads, its default and validation, how agent settings namespace legacy names, and what migration numbering restarted from.

<!-- stale README.md#build--run links land here; the section now lives in this file -->
<a id="build--run"></a>
<!-- stale README.md#code-map links land here; the section now lives in this file -->
<a id="code-map"></a>
### [Build, run and code map](/operation/worker/README/build-code-map.md)
Read when: building the binary, running tests, or finding which file owns what.
How to build the static binary and run the service locally, the four libraries and their boundaries, and what each Go file in the service owns.

<!-- stale README.md#deviations-from-the-java-version links land here; the section now lives in this file -->
<a id="deviations-from-the-java-version"></a>
### [Deviations from the Java version](/operation/worker/README/deviations.md)
Read when: porting Java behavior or hitting a search or protocol difference.
Where the Go service deliberately differs from the Java version: index formats, link fixes, the search break, regex engine, working directory, and socket protocol.
