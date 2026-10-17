# How-to: add a worker endpoint

The service is four libraries and one program (see the code map in [`README.md`](README.md)); a
new endpoint touches a predictable handful of files, all in the library that owns it —
`internal/files` for the store, `internal/hybridflow-runner` for the Claude tab, `internal/toolbox` for what is
installed on the machine.
**Wire compatibility is sacred** — never change an existing request/response shape or env var
name; only *adding* endpoints/fields is allowed. For the concepts see
[`README.md`](README.md) and [`PROTOCOL.md`](PROTOCOL.md); this is the checklist.

## 1. Route it (`internal/{files,hybridflow-runner,toolbox}/routes.go`)

Add one line to that library's `Routes()` table. The program mounts every table on the inner `mux`,
which is what gives a route the full `cors → request-id → trace → auth` chain; only unauthenticated
probes are registered on the root mux next to `/healthz`, in `server.go`.

```go
{Pattern: "GET /fooStat", Handler: s.HandleFooStat},
```

A new route is reachable by `files_user` alone. The read-only `files_reader` role sees only what
`readerRoutes` — the allowlist in `server.go`, beside the mux the tables are mounted on — names, so
a route that a listening client should be able to call goes there too, spelled exactly as its
`Pattern`. Such a route must take its subject as a `path` query parameter: that is what the reader
roots (`KIAO_WORKER_READER_ROOTS`) are matched against, and a request naming no `path` is
refused.

## 2. Handler (`internal/files/handlers_files.go` or `handlers_git.go`)

Handlers are thin: parse input, call the service, map errors. **Never pick a status code by hand** —
hand the error to `core.WriteError`, which classifies it (see step 4). Mirror the existing shape:

```go
func (s *Service) HandleFooStat(w http.ResponseWriter, r *http.Request) {
    p := r.URL.Query().Get("path")
    stat, err := s.files.fooStat(p)
    if err != nil {
        core.WriteError(w, r, err)
        return
    }
    core.WriteJSON(w, http.StatusOK, stat)
}
```

## 3. Service method (`internal/files/service.go`, or `git.go` for git)

Put the actual work on `FileService`/`GitService`, going through `core.Storage` (never touch the
filesystem directly — `core.ResolvePath` is the traversal boundary). Keep it HTTP-agnostic: return
the error sentinels, not status codes.

## 4. Error mapping (`internal/files/errors.go`, `internal/core/errors.go`)

If the operation has a new failure mode, return an existing sentinel where it fits
(`core.ErrNotDirectory`, `errBadPattern`, `core.ErrOutsideRoot`, `os.ErrNotExist`) or declare one
in that half with `core.Invalid("…")`, which classifies as 400 with no case to add anywhere. For a
one-off explicit code, return `&core.HTTPError{Status: …, Msg: …}`. 5xx causes are logged with the
request id and hidden from the client; 4xx messages are returned verbatim.

## 5. DTO — in **both** contract homes

If the endpoint returns/accepts JSON, define the DTO once on each side of the wire, with matching
field names:

- **Go**: [`internal/files/dto.go`](internal/files/dto.go) — the field names *are* the wire (they match
  the retired Java service; keep parity). The Claude ones are
  [`internal/hybridflow-runner/dto.go`](internal/hybridflow-runner/dto.go).
- **TypeScript**: [`reference/npm/kiao-worker/src/types.ts`](../../reference/npm/kiao-worker/src/types.ts)
  (Claude endpoints → `claude-types.ts`). This package is the single source of truth for the
  contract; `dashboard` consumes it, never a local copy.

Then add the client method to
[`reference/npm/kiao-worker/src/client.ts`](../../reference/npm/kiao-worker/src/client.ts), matching
the existing pattern:

```ts
async fooStat(path: string): Promise<FooStat> {
    const response = await this.fetch(this.getUrl('/fooStat', { path }));
    if (!response.ok) throw new WorkerError(`Foo stat failed: ${response.statusText}`, response.status, response.statusText);
    return response.json();
}
```

Rebuild the reference package so consumers see it: `cd reference/npm/kiao-worker && npm run build`.

## 6. Tests

- Service behavior: table-driven test next to the logic (`internal/files/service_test.go`,
  `git_test.go`, …), using `t.TempDir()` for fixtures.
- HTTP behavior: `internal/files/handlers_test.go` — assert status **and** the error-mapping
  contract (e.g. missing file → 404, traversal → 400, bad input → 400).
- Authorization, if the route joins the read-only surface: `internal/core/auth_test.go` — assert
  what `files_reader` reaches and, just as much, what it does not (a path outside the roots, a
  traversal out of one) — and add the route to `server_test.go`'s `TestReaderRoutesAreRouted`, which
  is what keeps the allowlist and the mux in step.

## 7. Document it

Add the route to the endpoint list in [`README.md`](README.md) and its request/response shape to
[`PROTOCOL.md`](PROTOCOL.md). A route absent from the README is exactly what the recurring audit
(`backlog/prompts/dcms/99-recurring-audit.md`) flags as drift.

## 8. Verify

```bash
go build ./... && go vet ./... && go test ./...     # from operation/worker
```
</content>
