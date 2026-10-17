# Classes — The Reusable Card

A **node class** is a card kept for reuse: the title, the kind, and the answers every instance
shares, with the words themselves kept as **versions** beneath it. It is filed on a board and
instantiated onto any board — which is what makes one team's good card another team's starting
point. Transport-agnostic like [cards.md](cards.md): the same over MCP (`class_*`,
`workflow_*`) or over HTTP with the preamble from
[api-curl.md](api-curl.md#reaching-the-boards).

## The Class

Every field of a class, as it is on the wire.

| Field | Rule |
|-------|------|
| `id` | A UUID, stable for the life of the class. Minted by the service unless you send one. |
| `title` | What the class is called. **Required** — a class needs a title. |
| `instantiable` | Whether the Instantiate menu offers it. Absent is off. |
| `type` | What kind of card it makes: `human`, `ai`, `shutdown` or `scheduler`. A Gateway holds no reusable words, so the service refuses one. |
| `tags` | The words its instances are filed under — the words themselves, like a card's. |
| `at` | A Scheduler class's preset datetime, `YYYY-MM-DDTHH:mm`. Nothing on every other type. |
| `spot` | Where the class sits on its board. Absent for one nobody has placed; `"clearSpot": true` takes it off again. |
| `onSuccess` | The class after this one — a class, never a version or a card — and, on an AI class, what becomes of an instance's chat. See [Chaining Classes](#chaining-classes). |
| `permission` | How an AI instance's tool calls are answered. Asked of an AI class alone. |
| `runner` | Which runner plays an AI instance — a runner's id, or empty. Asked of an AI class alone. |
| `note` | What the class is for. Asked of every kind of class and copied to no instance. |
| `workflowClass` | The workflow class the class is grouped in — one of this board — or absent for none. |
| `versions` | The succession, oldest first — see [Versions](#versions). |
| `revision` | The class's own revision; a version carries a revision of its own. Send it as `If-Match` when patching the class. |

A class holds what every instance shares — **no folder, no effort, no chat, no body of its own**.
Those are its versions' and its instances': the folder and the effort are chosen where the card
lands, because they say where the work runs and what it costs *there*.

```bash
curl -sS -H "$AUTH" "$HYBRIDFLOW/flow-node-classes"                     # every class, of every board
curl -sS -X POST "$HYBRIDFLOW/boards/major/flow-node-classes" -H "$AUTH" -H "$ACTOR" \
     -H 'Content-Type: application/json' \
     -d '{"title":"Review","type":"ai","body":"What the review asks.","published":true}'
curl -sS -H "$AUTH" "$HYBRIDFLOW/boards/major/flow-node-classes/<id>"   # one class, versions beneath
curl -sS -X PATCH "$HYBRIDFLOW/boards/major/flow-node-classes/<id>" -H "$AUTH" -H "$ACTOR" \
     -H 'Content-Type: application/json' -H "If-Match: 2" -d '{"note":"When to use it."}'
curl -sS -X DELETE "$HYBRIDFLOW/boards/major/flow-node-classes" -H "$AUTH" -H "$ACTOR" \
     -H 'Content-Type: application/json' -d '{"flowNodeClasses":["<id>"]}'  # 204
```

Creating a class files its first version's words beside it — `body`, `criteria`, `template`, and
the version's default `agent` — and `published: true` freezes that version at creation. The
listing answers each class with the board it is filed on, which is what the Instantiate menu
shows. **Ask before deleting one**: there is no undo, and its versions go with it.

A patch changes the class's own fields and never its versions': a new description is a new
version, not a patch.

## Versions

One version of a class: the words, under a successive number.

| Field | Rule |
|-------|------|
| `id` | Minted by the service. |
| `number` | Successive, oldest first. The succession is read in this order. |
| `body` | The description. |
| `criteria` | What done means, like a card's. |
| `template` | Whether the body is a template the instantiation fills in rather than copies. |
| `agent` | The default agent — a managed agent's id. Asked of an AI class's versions alone. |
| `status` | `draft` or `published`. Only a draft may be changed. |

```bash
curl -sS -X POST "$HYBRIDFLOW/boards/major/flow-node-classes/<id>/versions" -H "$AUTH" -H "$ACTOR" \
     -H 'Content-Type: application/json' -d '{"from":"<version-id>"}'   # a draft copied from it; {} is blank
curl -sS -X PATCH "$HYBRIDFLOW/boards/major/flow-node-classes/<id>/versions/<version-id>" \
     -H "$AUTH" -H "$ACTOR" -H 'Content-Type: application/json' -H "If-Match: 1" \
     -d '{"body":"What the review asks now.","status":"published"}'
curl -sS -X DELETE "$HYBRIDFLOW/boards/major/flow-node-classes/<id>/versions/<version-id>" \
     -H "$AUTH" -H "$ACTOR"                                             # 204
```

- **File a version from the one it follows** — `{"from":"<version-id>"}` — or blank with `{}`.
- **Publishing freezes the version.** A published version is refused whatever is sent, and is
  never drafted again: the next words are the next version.
- **An instantiated card arrives from the latest version that is not a draft.** A class with
  nothing published has nothing to instantiate.

## Instantiating

Making cards from a class — the class and all its successors, each from its latest published
version — on the board the call names, which may be another board than the class's own:

```bash
curl -sS -X POST "$HYBRIDFLOW/boards/other/flow-node-classes/<id>/instantiate" \
     -H "$AUTH" -H "$ACTOR" -H 'Content-Type: application/json' \
     -d '{"spot":{"x":0,"y":0},"bodies":{"<class-id>":"What this one is asked instead."}}'
```

- `spot` is where the head lands; omitted, the editor places the cards as it places the
  unplaced.
- `bodies` is what the instantiated **templates** are asked instead of their version's body,
  by class id. A version whose `template` is set is filled in; any other version is copied.
- **An instantiated AI card arrives naming no effort and no folder.** The agent comes from
  the version's default and the permission from the class, but where the turn runs and what
  it costs are chosen where it lands: pick both before the card can be played.

## Filing a Class from a Card

A card worth keeping is filed as a class with one call:

```bash
curl -sS -X POST "$HYBRIDFLOW/boards/major/flow-nodes/$id/to-class" -H "$AUTH" -H "$ACTOR" \
     -H 'Content-Type: application/json' -d '{}'
```

It takes a **task** — an AI card or a Human one. The card's title, kind and answers become the
class's, and its description and success criteria become the first version's.

## Binding a Card to a Version

A card made from a class remembers where it came from: `classVersion` reads back
`{ "classId", "classTitle", "versionId", "versionNumber" }`. It is read-only on the card —
patch `classVersion` with a version id to move it, `""` to break the link:

```bash
curl -sS -X PATCH "$HYBRIDFLOW/boards/major/flow-nodes/$id" -H "$AUTH" -H "$ACTOR" \
     -H 'Content-Type: application/json' -d '{"classVersion":"<version-id>"}'
```

## Chaining Classes

A class names the class after it — a class, never a version or a card — with the same link
call cards use, and instantiating follows it: the class and all its successors arrive
together. An empty target takes the link off.

```bash
curl -sS -X POST "$HYBRIDFLOW/boards/major/flow-node-classes/$first/chain" \
     -H "$AUTH" -H "$ACTOR" -H 'Content-Type: application/json' -d '{"flowNode":"'"$second"'"}'
```

On an AI class the link also says what becomes of an instance's chat — `mode` and `compact`,
as on a card. Only an AI class is asked.

## Workflows and Workflow Classes

A **workflow** is a name round a set of cards — the rectangle the board draws round its
members — and a **workflow class** is a name round a set of node classes. Either is a name
and nothing else: no spot of its own, no body, nothing but the id, the name, and a revision.

```bash
curl -sS -X POST "$HYBRIDFLOW/boards/major/workflows" -H "$AUTH" -H "$ACTOR" \
     -H 'Content-Type: application/json' -d '{"name":"Sprint","flowNodes":["<id>","<id>"]}'
curl -sS -H "$AUTH" "$HYBRIDFLOW/boards/major/workflows/<id>"              # one workflow
curl -sS -X PATCH "$HYBRIDFLOW/boards/major/workflows/<id>" -H "$AUTH" -H "$ACTOR" \
     -H 'Content-Type: application/json' -d '{"name":"Release"}'
curl -sS -X DELETE "$HYBRIDFLOW/boards/major/workflows" -H "$AUTH" -H "$ACTOR" \
     -H 'Content-Type: application/json' -d '{"workflows":["<id>"]}'       # 204
```

The same four calls under `/workflow-classes` name `classes` rather than `flowNodes` —
and `GET /workflow-classes` lists every workflow class of every board, as `class_list` does
for classes:

```bash
curl -sS -H "$AUTH" "$HYBRIDFLOW/workflow-classes"                        # every workflow class
curl -sS -X POST "$HYBRIDFLOW/boards/major/workflow-classes" -H "$AUTH" -H "$ACTOR" \
     -H 'Content-Type: application/json' -d '{"name":"Sprint","classes":["<id>"]}'
```

- **Membership is the member's.** A card names its workflow — at most one — so creating a
  workflow with a card already grouped moves it, patching a card's `workflow` groups it
  (`""` takes it out), and deleting a workflow ungroups its cards and leaves them where
  they are. Classes and workflow classes work the same way through `workflowClass`.
- **Members are of the board's own.** A card — or a class — of another board refuses the
  whole call.
- **Never the twain.** A workflow holds cards and a workflow class holds classes; there is
  no call that puts one in the other.

Making a workflow from a workflow class — one card per member, each from its latest
published version — on the board the call names, which may be another board than the
workflow class's own:

```bash
curl -sS -X POST "$HYBRIDFLOW/boards/other/workflow-classes/<id>/instantiate" \
     -H "$AUTH" -H "$ACTOR" -H 'Content-Type: application/json' -d '{}'
```

Like instantiating a class, `spot` says where the head lands and `bodies` fills in the
templates, by class id — and an instantiated AI card still wants its effort and its folder
before it can be played.
