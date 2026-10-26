# HTTP Fallback — Reaching the Boards Without the MCP Tools

Read this when the `kiao-hybridflow` MCP tools are **not** in the tool list. It is the same
store over plain HTTP: every tool has its call here, and the appendix maps each tool to its
endpoint. Card semantics live in [cards.md](cards.md), chains in [chains.md](chains.md),
classes and workflows in [classes.md](classes.md); what follows is the transport they all
fall back on.

## Reaching the Boards

Two variables say where the boards are and what to present to get at them. They are in the
environment of every turn the hybridflow-runner starts, because a turn is a child of the worker and inherits
its environment:

| | |
|---|---|
| `KIAO_WORKER_HYBRIDFLOW_URL` | the base of the API, with no trailing slash — `https://www.example.com/api/hybridflow`, or `http://127.0.0.1:18081` |
| `KIAO_WORKER_HYBRIDFLOW_TOKEN` | the **service token**, a Bearer [REDACTED] service accepts beside its Keycloak logins |

The names are the worker's own, and reading them here is borrowing rather than owning: they
are what that service was configured with, and the turn happens to be standing in its environment.

Start every piece of work on a board with the preamble, so that a missing variable is said out loud
once rather than turning into a `curl` that quietly asks `localhost` for nothing:

```bash
HYBRIDFLOW="${KIAO_WORKER_HYBRIDFLOW_URL:?no hybridflow-store configured}"
AUTH="Authorization: Bearer ${KIAO_WORKER_HYBRIDFLOW_TOKEN:?no service token}"
ACTOR="X-Kiao-Actor: claude"

curl -sS -H "$AUTH" "$HYBRIDFLOW/boards"
```

**When those variables are not set, there are no boards to edit.** Say so and stop. A worker naming
no hybridflow-store has no board this skill can reach, and the thing not to do is write
a file instead.

```
$HYBRIDFLOW/boards/major    the board, as this reference reaches it
```

### Saying who you are

`X-Kiao-Actor` is the name the change log records against everything the call does, and it is the
reason the token is not anonymous. **Send it on every write**, and send the truth: the agent you
are, in one word — `claude`.

- **Only the service token may name an actor.** A caller logged in with a Keycloak token is who its
  token says it is, and the header is ignored for it — that is what keeps this auditable rather than
  a way past the login.
- **Do not write somebody's name into it.** The token can say anything, which is exactly why what it
  says had better be true: a card the user later finds under their own name, which they never made,
  is a log that has stopped being worth reading.
- Omitted, the change is recorded as `worker`, which is a service saying it named nobody.

### What not to call

Three routes belong to the **runner** — the part of the worker that plays cards — and calling
them by hand breaks a play that is running or invents one that is not:

`POST /boards/{handle}/flow-nodes/{id}/play`, `POST /boards/{handle}/flow-nodes/{id}/played`,
`POST /runs/{run}/settle`.

A card is played from the board's Play button, never from here. To offer a card a turn, set it
`ready` and leave it to somebody to press.

## The Board, Whole

```bash
curl -sS -H "$AUTH" "$HYBRIDFLOW/boards"            # every board: name, handle, nothing on it
curl -sS -H "$AUTH" "$HYBRIDFLOW/boards/major"      # one board: cards, and a cursor
```

`GET /boards` answers `{"boards": [...]}`, one entry per board, and `?archived=1` includes the
archived ones. `GET /boards/{handle}` answers the board whole:

```json
{
  "board":   { "id": "…", "name": "Major", "slug": "major", "revision": 1, "archived": false },
  "flowNodes":   [ { "id": "…", "title": "…", "type": "ai", "status": "ready" } ],
  "flowNodeClasses": [],
  "workflows": [],
  "workflowClasses": [],
  "cursor":  1760
}
```

**A handle is a slug or an id, and both work everywhere `{handle}` appears.** The slug comes from the
name — "Tech Debt" is `tech-debt` — and a rename does not move it: the board stays at `major` when
somebody calls it "Majeur", so a link keeps working. Find the handle in the listing rather than
guessing it.

**Read the board before changing it.** Card ids, spots and revisions are all in that one
answer, and every write below names one of them.

### The folder a board has

A board has no path, but it does have a folder in the store: **`boards/<handle>`**. That is where an
image pasted into a card is written. It is named after the handle
and not the title, so renaming the board does not orphan the pictures its cards link to.
Archiving writes no file: it flips `archived` on the card.

## Writing

Every write is one call that changes what it names and nothing else.

```bash
curl -sS -X PATCH "$HYBRIDFLOW/boards/major/flow-nodes/$id" \
     -H "$AUTH" -H "$ACTOR" -H 'Content-Type: application/json' \
     -H "If-Match: 7" \
     -d '{"title":"Write the plan"}'
```

- **A patch names the fields it changes.** `{"status":"ready"}` moves nothing else. There is no
  read-modify-write and no whole card to send back, which is what lets a run mark a card while
  somebody is retitling it.
- **Two fields need saying twice**, JSON having no way to tell an absent key from one set to
  nothing: `"clearSpot": true` takes a card — or a class — off the board, and
  `"clearComplexity": true` takes the estimation off a card.
- **Two keys move a card between groups.** `"workflow": "<id>"` files the card in that
  workflow and `""` takes it out; `"classVersion": "<version-id>"` binds the card to that
  class version and `""` breaks the link.
- **`If-Match: <revision>` makes the write conditional.** With it, the write either lands on that
  revision or comes back `409` — read the card again and decide against what it now says. Without
  it, the write does not care, which is right for a status and wrong for a description somebody may
  have been editing while you read it. **Send it whenever you read a card, thought about it, and are
  writing it back.**
- **An unknown field is refused**, not ignored: a mistyped call does nothing rather than
  three-quarters of what was asked.
- Errors come back as `{"error": "…"}` with the status saying what kind: `400` malformed, `401` no
  or bad credential, `404` no such board or card, `409` a revision that has moved on or a card
  another run holds.

## No Store, No Boards

A worker naming no hybridflow-store has **no boards at all**: Play and the `/boards` proxy
refuse with 503. Say what you found and let the user decide to point the instance at a service.

## Watching a Board

A client that wants to know when a board moves reads it, keeps the `cursor` it came back with, and
asks what happened since:

```bash
curl -sS -H "$AUTH" "$HYBRIDFLOW/changes?since=$cursor&board=$boardId&wait=1"
```

`wait=1` **holds the request** until something happens on that board or the timeout runs out — about
twenty-five seconds — and answers with the changes and a new cursor. There is no window between the
read and the watch, and a client watching one board is never woken by another board's turns. Without
`wait`, it answers at once with whatever is there. (The MCP `board_changes` never waits: a tool
call answers, it does not hold.)

`board` is the board's **id** — the `id` of the `board` object, not its handle — and absent is
every board. `limit` caps the page at that many changes; the answer carries `more`, and when it
is true, ask again at once from the cursor it came back with.

Each change says what moved — `seq`, `at`, `scope`, `kind`, the ids of the board, card, class,
agent, runner or workflow it touched, the `actor` it is recorded against, and the `revision` the
move landed on — and the `cursor` is what to send as `since` next time.

It is for a client that draws a board, and it is rarely what a turn wants: a turn that has just
written something already knows what it wrote.

## Recipes

### Finding the board

```bash
curl -sS -H "$AUTH" "$HYBRIDFLOW/boards"
```

Match on `name` and use the `slug` from then on. Where the user names a board that is not there, say
which boards exist rather than creating one with a name close to what they said.

### Creating a board

```bash
curl -sS -X POST "$HYBRIDFLOW/boards" -H "$AUTH" -H "$ACTOR" -H 'Content-Type: application/json' \
     -d '{"name":"Major"}'
```

`201`, and the answer is the board whole — its handle among it. The name must be free, and the
handle is derived from it.

### Renaming, archiving and deleting a board

```bash
curl -sS -X PATCH "$HYBRIDFLOW/boards/major" -H "$AUTH" -H "$ACTOR" \
     -H 'Content-Type: application/json' -H "If-Match: 1" -d '{"name":"Majeur"}'
curl -sS -X PATCH "$HYBRIDFLOW/boards/major" -H "$AUTH" -H "$ACTOR" \
     -H 'Content-Type: application/json' -d '{"archive":true}'
curl -sS -X DELETE "$HYBRIDFLOW/boards/major" -H "$AUTH" -H "$ACTOR"       # 204
```

A rename does not move the handle: the board stays at `major`, so a link keeps working.
`archive: true` puts the board away — `GET /boards` leaves it out unless `?archived=1` is
asked — and `false` brings it back. **Deleting a board deletes everything on it** — cards,
classes, workflows — and there is no undo. Ask first.

### Adding a card

```bash
curl -sS -X POST "$HYBRIDFLOW/boards/major/flow-nodes" \
     -H "$AUTH" -H "$ACTOR" -H 'Content-Type: application/json' \
     -d '{"flowNodes":[{"title":"Write the plan","body":"What the card asks for."}]}'
```

`201`, and the answer holds the cards with the ids they were given. Give it a `title` **and** a
`body`: the title names the card, the description is what is sent — and a card with only a title is
played on its name, a card with only a criterion on that.

**Several cards in one call go in together, in the order given** — which is what a paste is.

### Reading one card

```bash
curl -sS -H "$AUTH" "$HYBRIDFLOW/boards/major/flow-nodes/$id"
```

Its fields, its revision, and the run holding it if one does. The board whole is the usual
read; this one is for a card whose id is already known.

### What one card spent

```bash
curl -sS -H "$AUTH" "$HYBRIDFLOW/boards/major/flow-nodes/$id/usage"
```

The sums of its reports — `reports`, `inputTokens`, `outputTokens`, `cacheReadTokens`,
`cacheWriteTokens`, `reasoningTokens`, and `costUsdMicros` where a report priced itself.
Absent cost is unknown, never zero.

### Asking a played card something else

Set its `status` back to `ready` — the description is still there, so it plays again as it stands —
or patch a new question into its `body` first:

```bash
curl -sS -X PATCH "$HYBRIDFLOW/boards/major/flow-nodes/$id" -H "$AUTH" -H "$ACTOR" \
     -H 'Content-Type: application/json' -d '{"body":"And now the other half.","status":"ready"}'
```

It keeps its `chat`, so the turn carries on from what the first one found out. **Do not** make a
second card that says everything again, and do not clear the `chat`: that is what the field is for.

### Moving a card

```bash
curl -sS -X PATCH "$HYBRIDFLOW/boards/major/flow-nodes/$id" -H "$AUTH" -H "$ACTOR" \
     -H 'Content-Type: application/json' -d '{"spot":{"x":320,"y":160}}'
```

A card sits where its `spot` says: patch it to move the card. **Keep the id**: a move is a move,
and the id is what a running play recognises the card by.

### Filing a card under a tag

Read the card, add the word, send the list back: `{"tags":["bug","ui"]}`. Use the spelling the rest
of the board uses; `{"tags":[]}` takes them all off.

### Typing a card

Patch `type`, and patch the fields that type is asked for in the same call. Take out what the new
type is no longer asked: the agent, the effort, the permission mode and the runner on anything but
an AI card (`"settings":{}` clears them), the folder on the three the board plays to itself, any
`chat`, any `mode` other than `end`, and — on a Shutdown — the flow node named after it. Typing
to a Gateway clears the single flow node named after it, and typing away from one clears its
branches.

**Typing a card away from a task loses its description.** A Shutdown, a Scheduler and a Gateway are
no task and the store keeps no `body` for one, so a card typed to any of them gives up what was
written in its box. Say so before doing it to a card somebody has written in.

### Making a card playable

```bash
# First, an agent that exists — see [Agents](cards.md#agents). Then:
-d '{"type":"ai","settings":{"agent":"<agent-id>","effort":"high","permission":"manualLive","folder":"/exchange/dashboard"}}'
```

All four, or the card is not played and nothing fills the missing one in for you. `agent` above all:
the two beside it are written in that agent's vocabulary, and an id nothing holds is refused at the
write. `runner` is the optional fifth: which machine plays the card, or wherever a Play is pressed
when absent.

### Chaining two cards

Give the first an `onSuccess` naming the second's id and a `mode` saying what the second is given of
the first's conversation. Both cards must be playable. Where the chat is
carried on — `continue` — both must name the **same `folder`**: a fork has the source's folder and no
other.

To chain a Gateway to a branch, draw the chain or call the link endpoint: the target is **added** to
its branches. Repeat for each branch — or patch `onSuccess` with the whole `flowNodes` list at once.
Taking one branch off is the panel's multi-select, or a patch naming the list without it.

### Marking a card

Patch `status`. `draft` puts a card being written out of a play's reach; `blocked` says the card is
written and waiting on something off the board; `ready` offers it a turn. The five a play writes are
the play's; see [Status and Chat](cards.md#status-and-chat).

### Deleting cards

```bash
curl -sS -X DELETE "$HYBRIDFLOW/boards/major/flow-nodes" -H "$AUTH" -H "$ACTOR" \
     -H 'Content-Type: application/json' -d '{"flowNodes":["<id>","<id>"]}'
```

`204`. **Ask first.** A card is minutes of somebody's thinking and there is no undo; a chain naming a
deleted card is left pointing at nothing, so take the `onSuccess` off the card before it in the same
piece of work.

### Grouping cards in a workflow

```bash
curl -sS -X POST "$HYBRIDFLOW/boards/major/workflows" -H "$AUTH" -H "$ACTOR" \
     -H 'Content-Type: application/json' -d '{"name":"Sprint","flowNodes":["<id>","<id>"]}'
curl -sS -X PATCH "$HYBRIDFLOW/boards/major/workflows/<id>" -H "$AUTH" -H "$ACTOR" \
     -H 'Content-Type: application/json' -d '{"name":"Release"}'
curl -sS -X DELETE "$HYBRIDFLOW/boards/major/workflows" -H "$AUTH" -H "$ACTOR" \
     -H 'Content-Type: application/json' -d '{"workflows":["<id>"]}'
```

A **workflow** groups flow nodes, and a **workflow class** groups node classes — the same three
calls under `/workflow-classes`, naming `classes` rather than `flowNodes`. Either is a name and
nothing else: the rectangle the board draws round its members, with no spot of its own. Membership
is the card's — a card names its workflow, at most one — so creating a workflow with a card already
grouped moves it, patching a card's `workflow` groups it (`""` takes it out), and deleting a
workflow ungroups its cards and leaves them where they are. Members are of the board's own: a card
of another board refuses the call. The full grouping rules — workflow classes, instantiation,
membership — live in [classes.md](classes.md#workflows-and-workflow-classes).

### Reading the schema

```bash
curl -sS -H "$AUTH" "$HYBRIDFLOW/schema"
```

The migration ledger: which version the store is on. For diagnosing a deployment, not for
daily work.

## Every Tool, over HTTP

Each `kiao-hybridflow` MCP tool and the call it stands on. Paths are from the store root —
the `$HYBRIDFLOW` of the preamble, with `{handle}` a slug or an id. (Through the worker
proxy the same paths wear a `/hybridflow-runner` prefix; the MCP tools go that way.)

| Tool | Call |
|------|------|
| `board_list` | `GET /boards` — `?archived=1` includes the archived ones |
| `board_create` | `POST /boards` |
| `board_get` | `GET /boards/{handle}` |
| `board_patch` | `PATCH /boards/{handle}` |
| `board_delete` | `DELETE /boards/{handle}` — 204 |
| `board_add_cards` | `POST /boards/{handle}/flow-nodes` |
| `board_get_card` | `GET /boards/{handle}/flow-nodes/{id}` |
| `board_patch_card` | `PATCH /boards/{handle}/flow-nodes/{id}` |
| `board_delete_cards` | `DELETE /boards/{handle}/flow-nodes` — 204 |
| `board_chain_card` | `POST /boards/{handle}/flow-nodes/{id}/chain` |
| `board_card_usage` | `GET /boards/{handle}/flow-nodes/{id}/usage` |
| `board_card_to_class` | `POST /boards/{handle}/flow-nodes/{id}/to-class` |
| `class_list` | `GET /flow-node-classes` |
| `class_create` | `POST /boards/{handle}/flow-node-classes` |
| `class_get` | `GET /boards/{handle}/flow-node-classes/{id}` |
| `class_patch` | `PATCH /boards/{handle}/flow-node-classes/{id}` |
| `class_delete` | `DELETE /boards/{handle}/flow-node-classes` — 204 |
| `class_chain` | `POST /boards/{handle}/flow-node-classes/{id}/chain` |
| `class_create_version` | `POST /boards/{handle}/flow-node-classes/{id}/versions` |
| `class_patch_version` | `PATCH /boards/{handle}/flow-node-classes/{id}/versions/{versionId}` |
| `class_delete_version` | `DELETE /boards/{handle}/flow-node-classes/{id}/versions/{versionId}` — 204 |
| `class_instantiate` | `POST /boards/{handle}/flow-node-classes/{id}/instantiate` |
| `workflow_create` | `POST /boards/{handle}/workflows` |
| `workflow_get` | `GET /boards/{handle}/workflows/{id}` |
| `workflow_patch` | `PATCH /boards/{handle}/workflows/{id}` |
| `workflow_delete` | `DELETE /boards/{handle}/workflows` — 204 |
| `workflow_class_list` | `GET /workflow-classes` |
| `workflow_class_create` | `POST /boards/{handle}/workflow-classes` |
| `workflow_class_get` | `GET /boards/{handle}/workflow-classes/{id}` |
| `workflow_class_patch` | `PATCH /boards/{handle}/workflow-classes/{id}` |
| `workflow_class_delete` | `DELETE /boards/{handle}/workflow-classes` — 204 |
| `workflow_class_instantiate` | `POST /boards/{handle}/workflow-classes/{id}/instantiate` |
| `agent_list` | `GET /agents` |
| `agent_create` | `POST /agents` |
| `agent_get` | `GET /agents/{id}` |
| `agent_patch` | `PATCH /agents/{id}` |
| `agent_delete` | `DELETE /agents/{id}` — 204 |
| `runner_list` | `GET /runners` |
| `runner_create` | `POST /runners` |
| `runner_get` | `GET /runners/{id}` |
| `runner_patch` | `PATCH /runners/{id}` |
| `runner_delete` | `DELETE /runners/{id}` — 204 |
| `board_changes` | `GET /changes?since=&board=&limit=` — `&wait=1` holds |
| `hybridflow_schema` | `GET /schema` |

Writes take the actor header and, where a revision was read, `If-Match`; deletes of one —
a board, an agent, a runner, a class version — carry the id in the path, while deletes of
many carry the ids in the body. What the bodies hold is in the recipes above and in
[classes.md](classes.md).
