# hybridflow-store

The boards and the flow nodes on them, in PostgreSQL. Go, hexagonal, one static binary.

It is the backend part of **hybridflow** — the workflow and agent feature — beside the boards
and conversations UI in Dashboard (the `hybridflow-ui` and `agent` plugins) and the
`hybridflow-runner` inside worker (conversations, turns, the play loop).

**A card that is work somebody does is a task.** Two of the five kinds are — an **AI** card an agent
plays and a **Human** card a person does — and everything only those two have is a row of `task`,
keyed by the flow node it belongs to: the description, where the work happens, what the turn is run
with, the chat it is played in and what becomes of that chat. A Shutdown, a Scheduler and a Gateway
are the board acting on its own machine, describe no work, and have no task. The word is worth
having because the alternative was to say "an AI or a Human flow node" every time.

It is the other half of the move described in
[`docs/architecture/containers/hybridflow-store/`](../../docs/architecture/containers/hybridflow-store/README.md)
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

Configuration is the table in [the deployment document](../../docs/architecture/containers/hybridflow-store/deployment.md). Two of the variables are deliberately
worker's own names (`KIAO_KEYCLOAK_ISSUER_URI`, `KIAO_KEYCLOAK_JWK_SET_URI`): the realm is one
realm, and the pair reads the same two lines of the same environment file.

## Tests

```bash
go test ./...                                    # everything that needs no database

docker run -d --name kiao-wf-test -e POSTGRES_PASSWORD=test -p 45432:5432 postgres:16-alpine
KIAO_HYBRIDFLOW_STORE_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:45432/postgres \
  go test ./...                                  # and the ones that do
```

The split is on purpose. **The rules are tested without a database** — `core/services`' tests hold
the in-memory store (`adapters/memory`), so a rule that quietly needed SQL would not compile. The
suite that does need PostgreSQL tests the three things only a database can promise: the conditional
claim (twenty goroutines, one row, one winner), the deferred chain a pasted batch relies on,
and the change log the triggers write. Each of its tests gets a schema of its
own in the given database, created and dropped around it, so it is parallel-safe and leaves nothing.

Requires PostgreSQL 15 or later; 16 is the version the image ships.

## The API

Every route needs a Keycloak token carrying `files_user`, except `GET /healthz`.

| | |
| --- | --- |
| `GET /healthz` | liveness, unauthenticated and untraced |
| `GET /schema` | the migration ledger: which version this instance is on |
| `GET /boards` | the boards page — names and handles, nothing on them |
| `POST /boards` | create one |
| `GET /boards/{handle}` | **the board, whole**: its cards, and the change cursor it was read at |
| `PATCH /boards/{handle}` | rename, archive |
| `DELETE /boards/{handle}` | the board and everything on it |
| `POST /boards/{handle}/flow-nodes` | create cards; several at once, because a paste is one gesture |
| `PATCH /boards/{handle}/flow-nodes/{id}` | change the fields the patch names, and no others |
| `DELETE /boards/{handle}/flow-nodes` | remove cards |
| `POST /boards/{handle}/flow-nodes/{id}/chain` | link to the card played next, or unlink |
| `POST /boards/{handle}/flow-nodes/{id}/play` | take the card for a run |
| `POST /boards/{handle}/flow-nodes/{id}/played` | mark the card and hand it back |
| `POST /runs/{run}/settle` | free every card a run still holds — what a restart calls |
| `GET /changes` | what happened after a cursor; `?wait=1` holds the request until something does |
| `GET,POST /agents` | the managed agents; create |
| `GET,PATCH,DELETE /agents/{id}` | one agent |
| `GET,POST /runners` | the runners; create |
| `GET,PATCH,DELETE /runners/{id}` | one runner |
| `POST /runners/{id}/heartbeat` | the runner is alive: stamps its last seen |

`{handle}` is a board's id **or** its slug: the client that has a URL holds a slug and the client
that has a card holds an id, and neither should have to know which the other uses.

### Four conventions worth reading once

**A handle is a slug, and a rename does not move it.** `/boards/major` is the board's address, in a
URL, a bookmark and a pasted link. Renaming "Major" to "Majeur" leaves it at `major`.

**`If-Match: <revision>` is what makes a write conditional.** With it, the write either lands on
that revision or comes back `409` — read the thing again and decide against what it now says.
Without it, the write does not care, which is what a run's status write means and what a person's
rename does not. A malformed `If-Match` is `400` rather than ignored: a client that meant to be
conditional and silently was not would overwrite somebody.

**A card and its task are one card on the wire.** `flowNode` is flat — `type`, `tags`, `body`,
`settings`, `at`, `spot`, `status`, `chat`, `onSuccess` — and the split into two tables stops at
this service's own edge. The wire is one definition of what a card is, shared by a database, two
services and a browser, and it is the board's own shape; `If-Match` is the
card's revision, task included, because there is one thing for a client to hold.

**Read the board, then watch from the cursor it gave you.** `GET /boards/{handle}` answers with a
`cursor`; `GET /changes?since=<cursor>&board=<id>&wait=1` is answered the moment anything on that
board moves, and names the card that moved. There is no window between the read and the watch, and
a client watching one board is never woken by another board's turns.

## Code map

| | |
| --- | --- |
| `core/entities/` | boards, cards (`flow_node.go`) and their tasks (`task.go`), agents, runners — pure Go, no driver |
| `core/ports/` | what the core asks of the outside world, as interfaces and nothing else |
| `core/services/` | the rules: `boards.go`, `flow_nodes.go` (including the two calls a play is made of), `agents.go`, `runners.go` |
| `adapters/postgres/` | the ports over PostgreSQL; `migrate.go` and `schema/` are the schema's history |
| `adapters/httpapi/` | the routes, the DTOs, the middleware chain |
| `adapters/auth/` | Keycloak JWTs — the ones worker accepts, and why it is a copy |
| `adapters/memory/` | the ports in maps: a test adapter, not a deployment option |
| `lib/` | `logging`, `httpx`, `config` — what two or more of them share |

`core/` imports no adapter. Nothing under it knows PostgreSQL, HTTP or Keycloak exist; `main.go` is
the only file that knows both halves do.
