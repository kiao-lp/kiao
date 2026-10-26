# Request handling and state

← [worker](/operation/worker/README.md) · assumes the index (contract, auth, errors).

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
connections, kills any running `claude` turns, and drains in-flight requests within a 20 s grace
window. It sets `ReadHeaderTimeout` and `IdleTimeout` but **no** `ReadTimeout`/`WriteTimeout` —
those would abort large up/downloads and the long-lived `/ws/hybridflow-runner` socket, which are legitimate.

**Service state** (`core/filesystem/state.go`, `app/main.go`). Everything the service owns and no content — the
migration ledger, the conversation registry, the process lock, the Dashboard config documents — lives
under `KIAO_WORKER_STATE_PATH`, which defaults to `<root>/.kiao-config`. It sits *in* the data
root on purpose: it is about that store and nothing else, so two stores on one machine get two
ledgers and two conversation registries instead of one shared set, and a store that is moved or
copied takes its own state with it. Being in the root, it is kept
out of the way twice over: the service drops a `.gitignore` of `*` into it, so a transcript full of
prompt text stays out of the Source Control panel and out of anything the user publishes, and
`Storage` refuses every path that lands in it, so it appears in no listing and no client can read,
rename or delete a registry through the file API (`errStatePath` → 400). Searches, the link fixer and
scope listings all skip it. Every registry is replaced with a temp-file + fsync + rename, so a
reader sees one whole document or the other. A `state.lock` in it is flocked for the process's
lifetime: two instances sharing a state directory would not corrupt a file, they would silently
discard each other's renames, so the second one is refused startup with a message naming the path —
which is now exactly what two services pointed at the same store deserve. `flock` is released by the
kernel on process death, so a refusal always means a live second instance and never a lock left
behind by a crash. The trade-off of the default: wiping and re-cloning the store takes the state
with it, and a deployment that would rather keep it sets the variable to a path outside the root.
One file in it is seeded rather than owned: that `.gitignore`, written only when absent, because an
operator who edited it is deciding about their own store and a restart must not overrule them. What
the store may be rewritten by is declared elsewhere — see **The store declaration** below; it left
this directory because it is the operator's configuration of their own store, not the service's
state.

**The store declaration** (`files/scope/kiaofiles.go`). Three passes reach past whatever anyone aimed at
them: file-store migrations at startup, the link fixer after a rename or a delete, and the walks
that answer a question about one folder by reading everything under it — search, and the scope a
delete reports. What in the store is content — and what is a `node_modules`, a build output tree or
a source checkout that happens to live there — is declared by the store itself, in `.kiao-files`. It
can sit in **any** directory and covers that directory and everything below, so a store holding
several unrelated repositories, or none at all, is declared correctly; a nested file adds to what
its ancestors said, and there is no negation. Patterns before any `[section]` bound every pass;
`[migration]`, `[refactor]` and `[search]` bound one each. The syntax, the two-implementation
contract and the worked example are in [`migrations/README.md`](/migrations/README.md).

A folder that is excluded is still walked when it is the folder the request named: the exclusion
keeps a pass out of the folders nobody pointed it at, not out of the one that was pointed at. So a
`/search` of a declared `vendor/` searches it, and a `/listRecursive` of it describes it in full,
while both stop at it when they were aimed at something above.

The root file is seeded on first start with the common machinery names **already in force** — which
is what makes a fresh store fast with nothing configured — and is the operator's from that moment
on. On a store written by the previous layout, `<state>/migration-ignore` is absorbed verbatim into
the `[migration]` section and removed. A root that cannot be written keeps the same defaults in
memory, so a read-only store is fast too. Only `.git` and the state directory are hard-wired:
machinery an operator can reason about belongs in a declaration, machinery this service owns must
not be made optional by an edit.

Why it matters for cost: the link fixer reads every scannable file in the store on **every** rename
and **every** delete, and a search reads every file below the folder it was given. On this repository as a store root, that is 5,816 directories and 1,719 files
read (3.4 s) with only the old hard-coded `node_modules`/dot-directory skips, against 492 and 203
(0.2 s) with the seeded defaults — and on the standalone Windows build, where the store is a bind
mount, every one of those file operations crosses a host filesystem boundary.

**State from the previous layout** (`state_legacy.go`). A store written before this move keeps the
registries at `<root>/.kiao/` and the two Dashboard documents under `<root>/config/`. Startup
collects them into the state directory, under the state lock and before the migration runner runs.
Each move is skipped when the destination already exists and nothing here can fail startup; the
emptied `.kiao` is removed, and a `.kiao` still holding anything unrecognised is left exactly as it
is. It is Go rather than a `V<NNN>` migration script for two reasons: the ledger that decides which
scripts run is itself one of the things being moved, and none of this is content, so a pass that
walks the store and honours `.kiao-files` would never reach it.

Two things are deleted rather than moved. That layout's migration ledger
(`<root>/.kiao/migrations.json`), because the numbering restarted at version 0, so adopting a ledger
claiming version 17 would only make `V001` be skipped without a word, on exactly the stores that
still carried the old file. And the
trusted-folder registry (`claude-trust.json`, in either location), because nothing reads it any more:
Claude reaches the whole store, so there is no list of folders to keep. Retired state files are named
in `retiredStateFiles`, and each removal is logged.

**Config documents** (`files/http/configdocs.go`). `GET`/`PUT /config/{name}` serve the documents Dashboard
reads and writes — `dashboard.json` (feature flags) and, for how the UI was left,
`dashboard-view-state.json` on a roomy viewport or `dashboard-view-state-small.json` on a small one
(view state *is* the layout, so a phone and a desktop cannot share it) — from the state directory. They used to be ordinary files in the store, fetched through
`/getFile`, which is what put machine configuration in the file browser, in `git status` and in a
published store; the state directory is unreachable from the file API even now that it sits in the
data root, so this pair exists instead. `{name}` is an **allow-list**, not a pattern: the ledger and
the conversation registry sit in the same directory, and a name-shaped parameter that reached those
would let any authenticated client rewrite which migrations a store thinks it has run. A `PUT` body
must parse as JSON and is capped at 1 MB. A `PUT` of `dashboard.json` — and of that one only — also
tells whoever registered `OnDashboardConfigSaved`, before the 204: the store's plugin list lives in
it, and which skills a store gets follows that list. View state is written on every drag of a
splitter and nobody listens to it.
