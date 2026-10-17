# kiao-mcp

A single package that ships **two MCP (Model Context Protocol) servers** letting a Claude turn
read and write KIAO content over the **worker**. They run in exactly one place — inside a
turn worker itself spawned, in a server deployment or in the kiao image — and are no longer installed on
a developer machine. Splitting the tools across servers keeps each one's tool surface (and the
descriptions loaded into the model's context) focused: a deployment enables the servers it needs.

- **`kiao-files`** (`dist/index.js`) — direct file access + git tools.
- **`kiao-hybridflow`** (`dist/hybridflow-entry.js`) — inspect, modify and create every kind of
  hybridflow object in real time: boards and their cards, workflows and workflow classes, node
  classes and their versions, managed agents and runners. worker proxies these to the
  hybridflow-store with its service token, attributing the change to the turn's owner — the turn
  holds no store credential.

The two share the same worker client, auth and config; `kiao-hybridflow` is a higher-level
domain API layered on the same client, so it still reaches the worker — it simply exposes its
domain tools instead of raw file/git access. Both are given the same per-turn token.

That shared slice is also published, as the `kiao-mcp/shared` subpath, for servers built outside
this package: the runner, the tool-result helpers and the types a domain API is written against.
A server built on it bundles it and is overlaid into this bundle's `dist/` beside the two
above — worker reads the directory, not the package each file came from.

## Tool families

- **Direct file access** (`kiao-files`) — `files_list`, `files_read`, `files_write`, `files_edit`,
  `files_info`, `files_delete`, `files_delete_batch`, `files_rename`, `files_mkdir`, `files_search`,
  plus git tools (`git_status`, `git_stage`, `git_unstage`, `git_revert`, `git_commit`, `git_push`,
  `git_pull`). `files_edit` is a surgical exact-string replacement (server-side
  read–modify–write): the way to make a small change to a large file — `files_write` would force
  the model to re-emit the whole content byte-exact, which is slow and risky above a few KB.
  `files_delete` removes a whole entry — a directory goes with everything under it, and a content
  file takes its `.config.json` sidecar — so emptying a folder by hand is never needed;
  `files_delete_batch` does the same for many paths in one request instead of one round trip each.
- **Boards** (`kiao-hybridflow`) — `board_*` (list, create, read whole, patch, delete;
  add, read, patch, delete and chain cards; a card's usage totals; file a class from a card;
  the change feed), `workflow_*` and `workflow_class_*` (create, read, patch, delete,
  instantiate), `class_*` (list, create, read, patch, delete and chain node classes; create,
  patch and delete versions; instantiate), `agent_*` and `runner_*` (list, create, read, patch,
  delete), `hybridflow_schema`. A board is a row in the hybridflow-store, reached through the
  worker (`/hybridflow-runner/…`), which proxies with its service token and records
  the turn's owner as the actor — so the change log says whose turn moved the card. A board is
  addressed by its **handle** (the slug `board_create` answers); `board_get` reads it whole —
  cards, node classes, workflows and workflow classes — and is the read every write starts from.
  Cards follow the hybridflow skill's field rules: `type` is written, `settings` and `tags` are
  whole replacements, `If-Match` (as `ifMatch`) makes a patch conditional on the revision just
  read. Playing a card is not here — `play`, `played` and `settle` are the runner's alone, as is
  the usage report a turn files and the heartbeat a runner stamps. Where the worker names no
  hybridflow-store the calls are refused with the reason; with no store named there is nowhere
  a board could be written.

## Build

```bash
cd reference/npm/kiao-mcp
npm install
npm run build      # -> dist/index.js (kiao-files), dist/hybridflow-entry.js
                   #    (kiao-hybridflow), dist/shared.js (the slice servers built
                   #    outside this package import and bundle)
npm test           # vitest unit tests
```

## One deployment

These servers are started by the `claude` CLI that worker spawns for a turn, and reach that
same worker back on `http://127.0.0.1:<port>`. The CLI already reaches the store's files
through `--add-dir`, but only these tools run the link-fix pass a plain `mv` does not — and
only `kiao-hybridflow` reaches the boards at all.

## Authentication

worker **mints a token per turn**, binds it to the user who asked for the turn, accepts it
on its own API, and destroys it when the turn settles — see `operation/worker/claude_mcp.go`.
It reaches this process through `KIAO_MCP_ACCESS_TOKEN`, which is why that variable exists and why
nothing else should ever set it.

There is deliberately **nothing else**. The two obvious alternatives both fail here: there is no
browser inside a spawned CLI to complete a PKCE login with, and passing the caller's own Keycloak
access token through would expire mid-turn with no refresh token on this side to recover with. So
no login flow is kept — a server started with neither `KIAO_MCP_ACCESS_TOKEN` nor
`KIAO_MCP_NO_AUTH` **refuses to start**, naming both, rather than sending every request out
unauthenticated and failing one file operation at a time.

`KIAO_MCP_NO_AUTH=1` is for a worker running its `debug` profile, which checks nothing.

## Configuration (environment)

| Variable | Default | Purpose |
| --- | --- | --- |
| `WORKER_URL` | `http://127.0.0.1:8080` | worker base URL. Set per turn to the local loopback address |
| `KIAO_MCP_NO_AUTH` | _(unset)_ | `1`/`true` to skip auth (worker `debug` profile) |
| `KIAO_MCP_ACCESS_TOKEN` | _(unset)_ | the bearer token to send. Set by worker for the turn and by nothing else; it outranks `KIAO_MCP_NO_AUTH`, so the user is named in the service's log even on a `debug` deployment |
| `KIAO_MCP_LOG` | _(unset)_ | `0`/`false` switches the tool-call log off entirely |
| `KIAO_MCP_LOG_DIR` | `<install dir>/logs/kiao-mcp` | where the tool-call log is appended |
| `KIAO_MCP_SLOW_CALL_MS` | `5000` | a call at least this slow is flagged `slow_call` |

`KIAO_MCP_NO_AUTH` or `KIAO_MCP_ACCESS_TOKEN` must be set: with neither, the server refuses to start.

## The tool-call log

Every `tools/call` this process serves is appended to `logs/kiao-mcp/YYYY-MM-DD.jsonl` — one JSON
object per line, a file per day, created on the way to the first write.

**The turn cannot see it.** No tool is added, no description grows, no result changes shape, and
nothing is written to stdout — stdout *is* the JSON-RPC channel of a stdio server. The log is not
in the store either: it goes beside the installed package, not into the working directory, which
for a turn is the store itself, where a file would be a document Dashboard lists and the agent can
read straight back.

```json
{"timestamp":"2026-09-06T11:54:56Z","server":"kiao-files","tool_name":"files_read","request_id":3,
 "duration_ms":0.874,"status":"error","arguments":{"path":42},"input_bytes":15,
 "output_bytes":342,"anomalies":["slow_call"],"error":{"name":"Error","message":"…","stack":"…"}}
```

`status` is `success`, `error`, or `unexpected` — a call that neither failed nor answered properly:
nothing in the content, a shape no client can read, a client that gave up waiting. `anomalies`
carries what is worth grepping for without being a failure: `slow_call`, `large_output`,
`empty_result`, `malformed_result`, `aborted`.

`input_bytes`/`output_bytes` are the wire sizes — what a call costs the turn's context, which is
the question here, since these servers reach worker and nothing that bills tokens. A tool
that ever does call an LLM reports its usage through `recordTokenUsage`, and the record grows
`input_tokens`/`output_tokens`/`total_tokens`.

Three properties are load-bearing, and `logging.ts` says why at each of them:

- **It wraps `tools/call`, not each tool.** One interception, on `Server.setRequestHandler`, before
  the first `registerTool` installs that handler. A wrapper around each handler would miss the
  calls that never reach one — an argument the schema rejects, a tool name the model invented —
  and those are the interesting ones.
- **It never blocks a call.** The interceptor captures references and returns; building the record
  and appending it happen afterwards, on a queue that serializes writes so two calls finishing
  together cannot interleave halfway through a line.
- **It never fails loudly.** An unwritable directory, a full disk, a value that will not serialize:
  all end as a dropped line, never as a failed tool call.

`arguments` is a sample, not a copy — strings over 500 characters cut, arrays over 20 entries cut,
and any key that looks like a credential redacted. A `files_write` carries a whole document; the
question a log line answers is *which* call it was, not what it wrote.

## What the tool surface costs, and why it is written the way it is

A server's tool list is re-sent with **every** request of a turn, so a description is not paid once
— it is paid on each round trip, for the whole turn. Two rules follow, and both are load-bearing:

- **A rule is written once.** It goes on the tool description that owns it, or on the field's
  fullest use, and the other sites name the field and leave the rule where it was stated. All the
  tools of a server reach the model in the same list, so a paragraph repeated across a dozen
  schemas teaches nothing the first copy did not — it just costs twelve times as much.
- **Tool results are serialized compact.** `ok()` in `tools-common.ts` never indents: the only
  reader is a model, and indentation is a quarter of a chain listing and nearly half of a
  `cv_overview`. Files *written to the store* keep their pretty form — those a human reads, in a
  git diff.

## Deploying to a server

`bin/stage-kiao-mcp.sh <dest>` builds and tests the package, then stages the self-contained bundle
a server deployment installs (under `/opt/kiao-worker/kiao-mcp`) and the kiao image ships
(`/opt/kiao/kiao-mcp`). worker is pointed at it with
`KIAO_WORKER_MCP_PATH`, and `KIAO_WORKER_MCP_SERVERS` chooses which servers a turn
gets — `files,hybridflow` by default. A deployment with servers of its own
overlays their entrypoints into the bundle's `dist/` and names them here beside these.

The dependency tree is installed on the *build* host, so a target needs `node` and not `npm` —
which is what the kiao image ships. The staged servers' only runtime dependencies are registry
packages — the `file:` dependencies are dev-only, used by the tests — so there is nothing to
vendor beside the bundle. The staging script starts every entrypoint before it declares
success, so a runtime import of one added later fails the build instead of the deployment.

It **compiles from source** rather than reusing whatever `dist/` is on the build host. Nothing
rebuilds these servers in passing any more, so trusting a stale `dist/` was the one way a release
could silently ship last month's tools. `bin/build-all.sh` runs the staging once into
`dist/kiao-mcp`; the image build copies the bundle from there. The unit tests run in the same step: a broken
server fails the deploy rather than the first turn that reaches for it.
