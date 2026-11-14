---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# hybridflow-ui

The board editor for [hybridflow-store](/operation/hybridflow-store/README.md). Boards are
PostgreSQL records reached at `/boards/<handle>`, with stable IDs for flow nodes, node classes
and workflows. The plugin claims no file type. Examples abbreviate IDs; service records use UUIDs.

## What it claims

The `/boards` app route opens the movable **Board** panel while the Document tab remains
mounted. It also contributes **Node**, **Workflow**, **Chain runs** and **Boards** tabs, and
**Node agents** and **Runners** tools-menu panels. Template forms use the Board panel's own
stack. Chain runs is hidden when chat is disabled.

The bare `/boards` route and Boards tab share a name-sorted list. The open board stays
highlighted while a document URL is active. Row actions appear on hover/focus and remain
visible on touch devices.

## Two writers, one board

A person can edit while the runner updates status and chat. Each gesture applies a pure local
operation and sends a **field-level service call** (`boardOps.ts`, `boardWrites.ts`). Avoid
whole-board replacement: it would discard concurrent work.

`useBoardSync` watches through a request held until the board changes. Incoming state is
three-way merged by stable IDs (`boardMerge.ts`): one-sided field edits survive, and local
values win when both sides changed the same field. `documentAt` notifications trigger earlier
refresh after runner writes. External agents and other tabs are writers too.

The runner rereads the board at each chain step, including prompt, successor and shutdown
choices. A task's description and success criteria form its prompt; complexity is planning
information only. Playing preserves the task text and position and records output in its chat.

## Topics

| Need | Guide |
| --- | --- |
| Locate implementation or change format rules | [Files](README/files.md) |
| Open/edit cards, mark sets, drop files | [Editing cards](README/editing-cards.md) |
| Transfer, duplicate or remove nodes | [Clipboard and archive](README/clipboard-and-archive.md) |
| Choose task, control or display kinds | [Node types](README/flow-node-types.md) |
| Configure explicit execution settings | [Settings](README/settings.md) |
| Reuse versions or group nodes | [Classes and workflows](README/classes-and-workflows.md) |
| Label and filter | [Tags](README/tags.md) |
| Arrange nodes and read arrows | [Board canvas](README/board.md) |
| Understand lifecycle and conversations | [Status and chat](README/status-and-chat.md) |
| Chain tasks and hand off chats | [On success](README/on-success.md) |
| Instantiate descriptions | [Templates](README/flow-node-templates.md) |
| Run, stop, retry or pass structured output | [Playing nodes](README/playing-flow-nodes.md) |

The [board design](docs/solution-design/board-ui.md) owns routing and UI
integration; the [store design](/operation/hybridflow-store/docs/solution-design/README.md)
owns persistence. Read topic pages as needed rather than loading the whole guide.

## Moved sections

Legacy anchors point to the current topic pages.

### Files

[files.md](README/files.md#files).

### Editing

[editing-cards.md](README/editing-cards.md#editing).

### Several cards at once

[editing-cards.md](README/editing-cards.md#several-cards-at-once).

### What a card shows

[editing-cards.md](README/editing-cards.md#what-a-card-shows).

### Copy, cut, paste and clone

[clipboard-and-archive.md](README/clipboard-and-archive.md#copy-cut-paste-and-clone).

### Cut

[clipboard-and-archive.md](README/clipboard-and-archive.md#cut).

### Move to another board

[clipboard-and-archive.md](README/clipboard-and-archive.md#move-to-another-board).

### Clone

[clipboard-and-archive.md](README/clipboard-and-archive.md#clone).

### Archiving

[clipboard-and-archive.md](README/clipboard-and-archive.md#archiving).

### Flow node types

[flow-node-types.md](README/flow-node-types.md#flow-node-types).

### The Shutdown card

[flow-node-types.md](README/flow-node-types.md#the-shutdown-card).

### The Scheduler card

[flow-node-types.md](README/flow-node-types.md#the-scheduler-card).

### The Gateway card

[flow-node-types.md](README/flow-node-types.md#the-gateway-card).

### Settings

[settings.md](README/settings.md#settings).

### Node classes

[classes-and-workflows.md](README/classes-and-workflows.md#node-classes).

### Workflows

[classes-and-workflows.md](README/classes-and-workflows.md#workflows).

### Tags

[tags.md](README/tags.md#tags).

### The filter above the board

[tags.md](README/tags.md#the-filter-above-the-board).

### The board

[board.md](README/board.md#the-board).

### Where a card sits, and who decides

[board.md](README/board.md#where-a-card-sits-and-who-decides).

### The gestures

[board.md](README/board.md#the-gestures).

### The arrows

[board.md](README/board.md#the-arrows).

### Status and chat

[status-and-chat.md](README/status-and-chat.md#status-and-chat).

### On success

[on-success.md](README/on-success.md#on-success).

### The transition mode

[on-success.md](README/on-success.md#the-transition-mode).

### Compact

[on-success.md](README/on-success.md#compact).

### Flow node templates

[flow-node-templates.md](README/flow-node-templates.md#flow-node-templates).

### Playing flow nodes

[playing-flow-nodes.md](README/playing-flow-nodes.md#playing-flow-nodes).

### The chain runs panel

[playing-flow-nodes.md](README/playing-flow-nodes.md#the-chain-runs-panel).

### Waiting for a usage limit

[playing-flow-nodes.md](README/playing-flow-nodes.md#waiting-for-a-usage-limit).
