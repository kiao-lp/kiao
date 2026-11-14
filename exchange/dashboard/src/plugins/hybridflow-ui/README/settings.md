---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Settings

[Board guide](../README.md) · [Node types](flow-node-types.md)

AI tasks require explicit **agent, effort, permission and folder** settings before they can
play. Playback never substitutes deployment defaults. Human tasks may keep a folder;
other types have no turn settings. Successor and chat handoff belong to
[onSuccess](on-success.md).

| Field | Meaning |
| --- | --- |
| `agent` | Managed agent ID, selected by name; the agent defines harness, model and standing instructions |
| `effort` | Thinking effort supported by that agent |
| `permission` | Tool approval mode supported by the agent's harness |
| `folder` | Store link to the working directory; `/` means root, empty means unset |
| `runner` | Optional runner ID; a pinned card refuses execution elsewhere |

A runner pin is independent of playability. Without a pin, the card runs where Play is pressed.
An existing conversation keeps its original folder even if the card's folder changes.

## Agent choices

Node agents are managed in the **Node agents** panel. Their descriptions explain when to choose
them and are never sent as instructions. Effort and permission options use the chosen harness's
vocabulary. Switching harnesses clears incompatible effort and permission choices; changing
agents clears the legacy model field. Older cards naming an engine and model remain readable,
but new writes use managed agent IDs.

## Creation and conversion

| Gesture | Settings written |
| --- | --- |
| Create an AI card from the canvas | First agent; `bypassPermissions` only if its harness offers it |
| Convert an existing card to AI | Retain or choose the first agent; no permission is granted automatically |
| Convert away from AI | Remove agent, legacy model, effort, permission and runner |
| Convert away from a task | Also remove folder |

Creation leaves effort and folder empty so cost and write location remain explicit choices.
Typing a card selects its AI or Human template without inserting text; see
[templates](flow-node-templates.md). Empty setting values are omitted when serialized.

## Folder input and display

The folder field appears on AI and Human tasks, with a required warning only for AI. It accepts
a dragged folder or the parent folder of a dragged file (`droppedFolder`); see
[file drag and drop](../../../core/files/docs/solution-design/file-drag-drop.md).

A settled card shows its agent name. Folder, effort and permission remain in the editor;
a missing required value produces a warning on the card and highlights the field to fix.
