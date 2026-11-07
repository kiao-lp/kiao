# How to add a worker endpoint

Choose the owning family: `files` for documents, `hybridflow-runner` for agent execution or
boards, `toolbox` for machine equipment. Its [code map](docs/solution-design/build-code-map.md)
identifies the service package and HTTP adapter.
Preserve existing request/response shapes and environment names.

## Route and access

Add the route to the family's `internal/<family>/http/routes.go` table:

```go
{Pattern: "GET /fooStat", Handler: s.HandleFooStat},
```

[app/server.go](internal/app/server.go) mounts the tables under the shared middleware.
`/healthz` is registered separately as an unauthenticated probe.
A new route requires `files_user` unless explicitly included in `readerRoutes` beside the mux.
Reader routes must take a `path` query parameter, which is checked against
`KIAO_WORKER_READER_ROOTS`.

## Handler and service

Put parsing and HTTP response handling in the owning `http` package. Put the operation in its
capability package, such as `files/content`, `files/search`, `files/git` or runner `turns`.
Expose the smallest operation the handler needs. Resolve content paths through
`filesystem.Storage` or `filesystem.ResolvePath`.

```go
func (s *Service) HandleFooStat(w http.ResponseWriter, r *http.Request) {
    stat, err := s.files.FooStat(r.URL.Query().Get("path"))
    if err != nil {
        httpkit.WriteError(w, r, err)
        return
    }
    httpkit.WriteJSON(w, http.StatusOK, stat)
}
```

Return an existing error where its meaning fits, or declare a capability-owned sentinel using
`faults.Invalid` from `core/errors`. `core/http.WriteError` maps caller errors to 400 and missing
files to 404. It logs 5xx causes without exposing their details. An explicit `httpkit.HTTPError`
selects a different status when required by the contract.

## Contract and client

Keep Go request and response models beside their owning capability. Match their JSON fields
with [reference/kiao-worker](/reference/kiao-worker/src/), the authoritative client
contract consumed by Dashboard. Add the client method and rebuild that package if it changes.
Document the endpoint and its shapes in [PROTOCOL.md](PROTOCOL.md) and the appropriate
[endpoint design](docs/solution-design/endpoints.md).

## Tests

Service tests sit beside the capability. HTTP integration tests sit under the family's `http`
package and check both status and response shape.
For a reader route, extend [access tests](internal/core/access/auth_test.go) and
[TestReaderRoutesAreRouted](internal/app/server_test.go), including traversal and out-of-scope paths.

Run the owning packages and their affected consumers. For changes across the whole worker:

```bash
go build ./...
go vet ./...
go test ./...
```

The [package dependency test](internal/app/packages_test.go) checks family and execution boundaries.
Use the [verification procedure](/.agents/skills/verify/SKILL.md) for affected browser scenarios.
