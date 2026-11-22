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
| `agent` | Managed agent ID. Its publication supplies standing instructions, skills and MCP tools. |
| `harness` | Execution harness chosen in the matrix |
| `model` | Model chosen in a Claude Code, Codex or Muse column |
| `profileId` | Worker profile chosen in a Pi column |
| `effort` | Thinking effort supported by that agent |
| `permission` | Tool approval mode supported by the agent's harness |
| `folder` | Store link to the working directory; `/` means root, empty means unset |
| `runner` | Optional runner ID; a pinned card refuses execution elsewhere |

A runner pin is independent of playability. Without a pin, the card runs where Play is pressed.
An existing conversation keeps its original folder even if the card's folder changes.

## Agent choices

The **Agent** button opens a matrix in tasks and AI task classes. New conversations and forks
use the same matrix. Each Claude Code, Codex and Muse column names an active model. Pi columns
name execution profiles. Choose the cell where the agent row meets the model or profile.
The harness panel in Tools controls the active models and their default. A class copies
its selection to new tasks. Changing the selected model on a task with a conversation forks
that conversation on its next play.

A missing agent retains its ID on the card. Choose another agent in its options or use
“Reinstall agent…” to clone its repository again. Agents are stored in the resource
manager's Git working trees. New agent accepts a Git URL or a path accessible to the resource
manager and commits a draft to the remote when the repository needs APM initialization.

## Creation and conversion

| Gesture | Settings written |
| --- | --- |
| Create an AI card from the canvas | Choose an agent while defining the task |
| Convert an existing card to AI | Retain an explicit agent selection or choose one in settings |
| Convert away from AI | Remove the agent selection, effort, permission and runner |
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
