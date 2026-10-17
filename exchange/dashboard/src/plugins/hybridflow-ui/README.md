# hybridflow-ui

A **board** is a row in PostgreSQL, served by
[`operation/hybridflow-store`](/operation/hybridflow-store/README.md) and reached at its
own URL — `/boards/major`, with the Boards toolbar tab listing them all. It holds flow nodes, node
classes and the workflows grouping them, each with an id of its own. This plugin is that board's
editor — a card per flow node and per class, laid out on a canvas and chained to what comes after
it, drag to move, right-click for the menu — and playing a flow node hands it to an agent.

> **Read this first if the rest of the file surprises you.** Most of what follows describes the
> *shape* of a board and the *rules* about it — the JSON below — and how it is kept and written:
>
> - **The grain of a write is a field of a card**, not the whole board. Every gesture runs its pure
>   operation locally and sends the one call that makes it true (`boardWrites.ts`), so a run marking
>   a card and a person renaming one are two writes that both land.
> - **A board is watched, not polled.** A request held by the service comes back the moment this
>   board moves (`useBoardSync.ts`); a re-read is merged into what is on screen (`boardMerge.ts`).
> - **The board shape is also read from a paste.** `boardContent.ts` is its reader and writer,
>   forgiving on the way in: a card may have been hand-written or pasted from another instance.
>
> `docs/architecture/containers/hybridflow-store/` is the store's side —
> `schema.md` for the schema, `board-ui.md` for the editor.

```json
{
  "flowNodes": [
    {
      "id": "9a6d4c31-…",            ← stable for the life of the flow node
      "title": "Write the plan",     ← the card's name, and no part of the prompt
      "type": "ai",                  ← what kind of card it is; Human says it by silence
      "tags": ["bug", "ui"],         ← the words it is filed under
      "body": "Introduction.",       ← the description: what is sent
      "criteria": [{ "id": "…", "text": "…what done means…" }],
      "complexity": 5,               ← Fibonacci points, never sent anywhere
      "settings": { "agent": "…its agent id…", "effort": "high",
                    "permission": "manualLive", "folder": "/" },
      "status": "done",              ← where it stands, in one of eight words
      "chat": "1f0c…",               ← the conversation it is played in, and keeps
      "onSuccess": { "flowNode": "…", "mode": "continue",
                     "compact": true },  ← played next, in a fork of this card's chat
    },
    { "id": "5c8b3e64-…", "title": "Some day" }
  ],
  "flowNodeClasses": [ … ],          ← the reusable cards, with their versions
  "workflows": [{ "id": "…", "name": "Release" }],
  "workflowClasses": []
}
```

A board is named by its handle: `/boards/major` is the board "Major".

**A flow node has a box to write in.** The `body` is the **description** — what is sent when the
flow node is played, or the title where there is none — and a play leaves it exactly where it is.
What the turn said is in the conversation the card names, which is the one record of it, and the
card still asks what it was asking. A task also holds **success criteria** — short lines saying what
done means, sent with the prompt whenever present — and an optional **complexity** in Fibonacci
points, never sent anywhere. A card with no title, no description and no success criterion carries
no Play: there is nothing to send.

**A card sits where it was put, and a chain says what runs after what.** What a play did with a
flow node is the flow node's own `status`, and what runs after it is the flow node's own
`onSuccess`. The chain is the whole of the order a board has: nothing else on it says what comes
after what.

## What it claims

No file type: a board is not a document of the store. It claims a URL prefix instead —
`/boards`, through `appRoutes` — and draws the board, or the page that lists them, under it.

Around the board it registers six toolbar tabs: **Node** (the open card), **Workflow** (the open
rectangle), **Chain runs** (every run, on any board), **Node agents** and **Runners** (what plays
a card and where), and **Boards** (the way in to each board, leaving the open document where it
is). The chain runs tab is off where the deployment has no chat; the boards list is also a page
of its own at the bare `/boards` URL.

## Two writers, one board

A board is written **from both ends at once**, and that is not an accident to be guarded against —
it is the point. A run lives in the hybridflow-runner and lasts minutes to hours: it marks the flow node it
took `running` and writes down the conversation it is playing it in, straight into the board.
Starting a play is meant to leave the board free to write the next ticket in, and writing that
ticket is meant to reach a run already under way.

**Going out.** Every edit here is sent as the call that makes it true, and the run reads the
board afresh at every step of the chain — a flow node's prompt, what runs after it, whether the
machine goes off at the end are all read off the service, never off a copy the run started with. So a
card rewritten while its own turn is running is the card the *next* step sees.

**Coming in.** The board is watched while it sits on it — a request the service holds until the
board moves (`useBoardSync`) — so a run marking a card, an agent's turn holding the `hybridflow`
skill and a second tab all reach the screen without anybody reopening anything. The run additionally
*says* when it has written (`documentAt`), which takes the watch's round trip off that one case.

**And where the two meet, they are merged rather than one of them dropped** — `boardMerge.ts`. The
run writes `status` and `chat`; everything else is only ever written here, so a three-way merge over the
ids the format already carries keeps both: a field one side moved is that side's, a field both moved is
the one on screen.

## Ordering

The plugin claims no file type, so it takes no place in the `PLUGINS` order: `findFilePlugin` never
offers it for a file, and the rename box never offers a board suffix.


## Topics

**[Files](/exchange/dashboard/src/plugins/hybridflow-ui/README/files.md)**

Read when: you need to find the code behind a gesture or check what the format guarantees.

Maps every source file to its role and states the format rules: forgiving reads, narrow writes, id-keyed edits, and the runner reading the same shape.

**[Editing cards](/exchange/dashboard/src/plugins/hybridflow-ui/README/editing-cards.md)**

Read when: you open, type, drag, mark, or read a card on the canvas.

Covers the panel and large editor, focus and drafts, multi-card marks and gestures, and what each card shows without being opened.

**[Copy, cut, paste, clone, move and archive](/exchange/dashboard/src/plugins/hybridflow-ui/README/clipboard-and-archive.md)**

Read when: a card travels between boards or leaves the board for good.

Explains clipboard JSON and id minting, cut safety, moves within the store, cloning on the same board, and archiving to markdown.

**[Flow node types](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-types.md)**

Read when: you pick or change a card kind and ask what each kind needs.

Defines AI, Human, Shutdown, Scheduler and Parallel gateway cards, what each asks for, how typing converts settings, and how typeless documents still read.

**[Settings](/exchange/dashboard/src/plugins/hybridflow-ui/README/settings.md)**

Read when: an AI card refuses to play or you set agent, effort, permission, folder or runner.

Details the five settings, why all four play settings are required with no fallbacks, and how typing, dragging and defaults fill them.

**[Node classes and workflows](/exchange/dashboard/src/plugins/hybridflow-ui/README/classes-and-workflows.md)**

Read when: you reuse a card or group cards under one named rectangle.

Describes reusable classes with versions and notes, instantiation with template panels, and workflows as computed rectangles drawn round member cards.

**[Tags](/exchange/dashboard/src/plugins/hybridflow-ui/README/tags.md)**

Read when: you file cards under words or filter the board down to some of them.

Covers word-based tags with store colours, the picker, the filter row above the canvas, and what hidden cards still take part in.

**[The board](/exchange/dashboard/src/plugins/hybridflow-ui/README/board.md)**

Read when: you arrange cards, read chains, or ask where places and arrows come from.

Explains canvas layout and chain-following placement, drag and menu gestures, and edge-to-edge arrows drawn solid or dashed by chat handoff.

**[Status and chat](/exchange/dashboard/src/plugins/hybridflow-ui/README/status-and-chat.md)**

Read when: you read where a card stands or open the conversation it was played in.

Defines the eight statuses with colours and play gates, plus how chats attach to cards, open from panel or card, and survive retyping.

**[On success](/exchange/dashboard/src/plugins/hybridflow-ui/README/on-success.md)**

Read when: you chain cards and decide what becomes of the chat afterwards.

Covers the next-card link, end versus forked continue, the compact box, folder matching, chain ends, and how failures skip the whole handoff.

**[Flow node templates](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-templates.md)**

Read when: you write descriptions from reusable templates with variables and clauses.

Explains the template folder and picker, the AI and Human defaults, variables the card answers itself, and the instantiation panel flow.

**[Playing flow nodes](/exchange/dashboard/src/plugins/hybridflow-ui/README/playing-flow-nodes.md)**

Read when: you press Play and follow runs, costs, stops, retries and usage waits.

Describes the runner loop, run naming and the runs panel, prompts with images, stop behaviour, error retries, spending rows and limit clocks.

## Moved sections

Old anchors keep working here. Each stub links to the file the section now lives in.

### Files

Moved to [files.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/files.md#files).

### Editing

Moved to [editing-cards.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/editing-cards.md#editing).

### Several cards at once

Moved to [editing-cards.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/editing-cards.md#several-cards-at-once).

### What a card shows

Moved to [editing-cards.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/editing-cards.md#what-a-card-shows).

### Copy, cut, paste and clone

Moved to [clipboard-and-archive.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/clipboard-and-archive.md#copy-cut-paste-and-clone).

### Cut

Moved to [clipboard-and-archive.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/clipboard-and-archive.md#cut).

### Move to another board

Moved to [clipboard-and-archive.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/clipboard-and-archive.md#move-to-another-board).

### Clone

Moved to [clipboard-and-archive.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/clipboard-and-archive.md#clone).

### Archiving

Moved to [clipboard-and-archive.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/clipboard-and-archive.md#archiving).

### Flow node types

Moved to [flow-node-types.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-types.md#flow-node-types).

### The Shutdown card

Moved to [flow-node-types.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-types.md#the-shutdown-card).

### The Scheduler card

Moved to [flow-node-types.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-types.md#the-scheduler-card).

### The Gateway card

Moved to [flow-node-types.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-types.md#the-gateway-card).

### Settings

Moved to [settings.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/settings.md#settings).

### Node classes

Moved to [classes-and-workflows.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/classes-and-workflows.md#node-classes).

### Workflows

Moved to [classes-and-workflows.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/classes-and-workflows.md#workflows).

### Tags

Moved to [tags.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/tags.md#tags).

### The filter above the board

Moved to [tags.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/tags.md#the-filter-above-the-board).

### The board

Moved to [board.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/board.md#the-board).

### Where a card sits, and who decides

Moved to [board.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/board.md#where-a-card-sits-and-who-decides).

### The gestures

Moved to [board.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/board.md#the-gestures).

### The arrows

Moved to [board.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/board.md#the-arrows).

### Status and chat

Moved to [status-and-chat.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/status-and-chat.md#status-and-chat).

### On success

Moved to [on-success.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/on-success.md#on-success).

### The transition mode

Moved to [on-success.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/on-success.md#the-transition-mode).

### Compact

Moved to [on-success.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/on-success.md#compact).

### Flow node templates

Moved to [flow-node-templates.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-templates.md#flow-node-templates).

### Playing flow nodes

Moved to [playing-flow-nodes.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/playing-flow-nodes.md#playing-flow-nodes).

### The chain runs panel

Moved to [playing-flow-nodes.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/playing-flow-nodes.md#the-chain-runs-panel).

### What an AI card spent

Moved to [playing-flow-nodes.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/playing-flow-nodes.md#what-an-ai-card-spent).

### Waiting for a usage limit

Moved to [playing-flow-nodes.md](/exchange/dashboard/src/plugins/hybridflow-ui/README/playing-flow-nodes.md#waiting-for-a-usage-limit).

