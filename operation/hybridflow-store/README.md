---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# hybridflow-store

The boards and the flow nodes on them, in PostgreSQL. Go, hexagonal, one static binary.

It is the backend part of **hybridflow** — the workflow and agent feature — beside the Hybridflow
plugin in Dashboard and the
`hybridflow-runner` inside worker (conversations, turns, the play loop).

The store gives each AI and Human flow node a `task` row keyed by that node's ID. The row
holds the description, settings, conversation reference and conversation handoff. See the
[Hybridflow concept catalog](/docs/architecture/data/hybridflow-concept-catalog.md).

It is the other half of the move described in
[`operation/hybridflow-store/docs/solution-design/`](docs/solution-design/README.md)
— **read that first**: it has the class diagram of the schema, the reasoning behind its shape, and what the
import of the store's existing boards found.

## Build and run

```bash
./build.sh                      # linux/amd64, static, no CGO
go build ./... && go test ./...  # what CI would do

KIAO_HYBRIDFLOW_STORE_DATABASE_URL=postgres://…/hybridflow \
KIAO_HYBRIDFLOW_STORE_AUTH_MODE=debug \
KIAO_HYBRIDFLOW_STORE_CORS_ORIGINS=http://localhost:3000 \
  go run .
```

The schema is brought up to date at startup, before the listener opens. There is no separate
migration step to remember, and no way to serve against a schema this binary was not built for.

Configuration is the table in [the deployment document](docs/solution-design/deployment.md). Two of the variables are deliberately
worker's own names (`KIAO_KEYCLOAK_ISSUER_URI`, `KIAO_KEYCLOAK_JWK_SET_URI`): the realm is one
realm, and the pair reads the same two lines of the same environment file.

## Tests

```bash
go test ./...                                    # everything that needs no database

docker run -d --name kiao-wf-test -e POSTGRES_PASSWORD=test -p 45432:5432 postgres:16.16-alpine
KIAO_HYBRIDFLOW_STORE_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:45432/postgres \
  go test ./...                                  # and the ones that do
```

The split is on purpose. **The rules are tested without a database** — `core/services`' tests hold
the in-memory store (`adapters/memory`), so a rule that quietly needed SQL would not compile. The
suite that does need PostgreSQL tests the three things only a database can promise: the conditional
claim (twenty goroutines, one row, one winner), the deferred chain a pasted batch relies on,
and the change log the triggers write. Each of its tests gets a schema of its
own in the given database, created and dropped around it, so it is parallel-safe and leaves nothing.

Requires PostgreSQL 15 or later with current security updates; the image ships PostgreSQL
16.16 or later in the 16.x line.

## The API

Every route needs a Keycloak token carrying `files_user`, except `GET /healthz`.

| | |
| --- | --- |
| `GET /healthz` | liveness, unauthenticated and untraced |
| `GET /schema-values` | JSON Schema values from all boards, for AI output types |
| `GET /schema-values/{id}` | resolve a task output schema |
| `GET /schema` | the migration ledger: which version this instance is on |
| `GET /boards` | the boards page — names and handles, nothing on them |
| `POST /boards` | create a board with a `name` and an optional `folderId` |
| `GET /boards/{handle}` | **the board, whole**: its flow nodes, and the change cursor it was read at |
| `PATCH /boards/{handle}` | rename, archive or move to a classification folder |
| `DELETE /boards/{handle}` | the board and everything on it |
| `GET,POST /folders/boards` | list board folders or create one with `{ "name": "…" }` |
| `PATCH,DELETE /folders/boards/{id}` | rename a folder or remove it and return its boards to the top level |
| `GET /flow-nodes/{id}/board` | resolve a flow node ID to its board summary |
| `POST /boards/{handle}/flow-nodes` | create flow nodes; several at once, because a paste is one gesture |
| `GET /boards/{handle}/workflows/{id}/clipboard` | export a workflow and its members as versioned clipboard JSON |
| `POST /boards/{handle}/workflows/clipboard` | paste `{ "clipboard": …, "spot": { "x": …, "y": … } }`; omit `spot` to place below existing flow nodes |
| `PATCH /boards/{handle}/workflows/{id}` | edit the name, `workflowFolder` or `files`, or change shared values using `setValues` and `removeValues` |
| `PATCH /boards/{handle}/flow-nodes/{id}` | change the fields the patch names, and no others |
| `DELETE /boards/{handle}/flow-nodes` | remove flow nodes |
| `POST /boards/{handle}/flow-nodes/{id}/chain` | link to the flow node played next, or unlink |
| `POST /boards/{handle}/flow-nodes/{id}/play` | claim a Ready or Done flow node for a run and detach a Done AI flow node's previous chat |
| `POST /boards/{handle}/flow-nodes/{id}/played` | finish the claimed flow node and commit its output and any workflow value updates |
| `POST /boards/{handle}/flow-nodes/{id}/pass` | complete a limiter pass at the supplied flow node revision and return the selected successor |
| `POST /runs/{run}/settle` | free every flow node a run still holds — what a restart calls |
| `GET /changes` | what happened after a cursor; `?wait=1` holds the request until something does |
| `GET,POST /agents` | the managed agents; create |
| `GET,PATCH,DELETE /agents/{id}` | one agent |
| `POST /agents/{id}/publish` | publish the draft as the next immutable version; supports `If-Match` |
| `GET /agents/{id}/versions` | all published configurations, oldest first |
| `GET,POST /runners` | the runners; create |
| `GET,PATCH,DELETE /runners/{id}` | one runner |
| `POST /runners/{id}/heartbeat` | the runner is alive: stamps its last seen |

Agent routes forward to [agentic-resource-manager](../agentic-resource-manager/README.md).
It owns source editing, publication, deletion confirmation and package delivery. A task conversation
pins its selected publication. Replaying a completed task creates a conversation with the current
publication.

`{handle}` is a board's id **or** its slug: the client that has a URL holds a slug and the client
that has a flow node holds an id, and neither should have to know which the other uses.

Supply `folderId` to create a board directly in a folder or to move an existing board. An empty
string places it at the top level. Moving a board preserves its slug and flow nodes.

Workflows store `workflowFolder` and each entry in `files` as paths from the DCMS root.
A patch replaces either field when supplied. Send `""` to clear the folder or `[]` to clear the
files. Clipboard copies carry both fields.

### Four conventions worth reading once

**A handle is a slug, and a rename does not move it.** `/boards/major` is the board's address, in a
URL, a bookmark and a pasted link. Renaming "Major" to "Majeur" leaves it at `major`.

**`If-Match: <revision>` is what makes a write conditional.** With it, the write either lands on
that revision or comes back `409` — read the thing again and decide against what it now says.
Without it, the write does not care, which is what a run's status write means and what a person's
rename does not. A malformed `If-Match` is `400` rather than ignored: a client that meant to be
conditional and silently was not would overwrite somebody.

**One flow node has one revision.** The API includes task fields such as `body` and
`settings` in the same `flowNode` object. `If-Match` checks the flow node's revision for
every write, including a patch that touches only task fields.

**Read the board, then watch from the cursor it gave you.** `GET /boards/{handle}` answers with a
`cursor`; `GET /changes?since=<cursor>&board=<id>&wait=1` is answered the moment anything on that
board moves, and names the flow node that moved. There is no window between the read and the watch, and
a client watching one board is never woken by another board's turns.

`KIAO_AGENTIC_RESOURCE_MANAGER_URL` selects the agent service; its technical bearer uses
`KIAO_AGENTIC_RESOURCE_MANAGER_SERVICE_TOKEN`. Agent identities are resolved through HTTP.
`POST` and `GET /boards/{handle}/flow-nodes/{id}/executions` record and read immutable
execution provenance. New run claims include `agentPackage: true`.

## Code map

| | |
| --- | --- |
| `core/entities/` | boards, flow nodes (`flow_node.go`) and their tasks (`task.go`), agents, runners — pure Go, no driver |
| `core/ports/` | what the core asks of the outside world, as interfaces and nothing else |
| `core/services/` | the rules: `boards.go`, `flow_nodes.go` (including the two calls a play is made of), `agents.go`, `runners.go` |
| `adapters/agentclient/` | Agent identity lookup and API forwarding to the resource manager |
| `adapters/postgres/` | the ports over PostgreSQL; `migrate.go` and `schema/` are the schema's history |
| `adapters/httpapi/` | the routes, the DTOs, the middleware chain |
| `adapters/auth/` | Keycloak JWTs — the ones worker accepts, and why it is a copy |
| `adapters/memory/` | the ports in maps: a test adapter, not a deployment option |
| `lib/` | `logging`, `httpx`, `config` — what two or more of them share |

`core/` imports no adapter. Nothing under it knows PostgreSQL, HTTP or Keycloak exist; `main.go` is
the only file that knows both halves do.
