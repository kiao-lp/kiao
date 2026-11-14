---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

<a id="request-handling-and-state"></a>
# Request lifecycle

← [worker](../../README.md). See its authorization and error contracts.

**Middleware chain** (`core/http/http.go`, mounted in `app/server.go`, outermost first): `recover → cors → request-id → trace →
auth → mux`. `GET /healthz` is registered on the root mux *outside* that chain, so the liveness
probe stays unauthenticated, untraced and cheap. The panic-recovery wrapper logs a stack and
returns 500 so one bad request can't take the process down; it deliberately does **not** wrap the
`ResponseWriter`, keeping the WebSocket handler's `http.Hijacker` reachable.

**Observability** (`core/logging/log.go`). `httpkit.WithRequestID` assigns a short id to every request, stores it in the
context and echoes it as `X-Request-Id`; `httpkit.TraceMiddleware` logs one structured line per request
(method, redacted path, user/roles/source, status, auth decision, elapsed). Logging is `log/slog`
text with per-subsystem `component=` loggers, to stdout (journald under systemd).

**Graceful shutdown** (`app/main.go`). On `SIGINT`/`SIGTERM` (systemd stop) the service stops accepting
connections, stops running agent turns, and drains in-flight requests within a 20 s grace
window. It sets `ReadHeaderTimeout` and `IdleTimeout` but **no** `ReadTimeout`/`WriteTimeout` —
those would abort large up/downloads and the long-lived `/ws/hybridflow-runner` socket, which are legitimate.

## Related responsibilities

- [Operational state](./state.md): directory isolation, process lock and legacy adoption.
- [Store scope](/migrations/README.md#kiao-files): `.kiao-files` exclusions for automatic passes.
- [Config documents](../../PROTOCOL/config-documents.md): allowed names, validation and save listeners.
