---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Flow node templates

[Board guide](../README.md) · [Clipboard guide](clipboard-and-archive.md)

For an editable Markdown description, the task toolbar in the **Flow node** panel offers an Instantiate
template icon immediately to the left of Archive, available from Spec, Options and Result.
Clicking it lists the templates. Choose one to open its instantiation panel.
Templates are `.temp.md` files in the flat `kiao-user-config/flow-node-templates` folder,
edited by `template-edit` with its variables, optional sections and value providers. The
file can start with a name as a level-one heading or directly with `## Root`. The selected
template lives in the panel draft.

## Templates carried by a node

Turn on **Multi-part template** next to the status selector on an editable task.
The **Spec** tab opens the template editor in place of the description field. Task
templates start with `## Root` and use the task's title to identify them on the board.
The existing description goes into Root if it has no template structure yet. If the
description has a Root `textTemplate` block, a dialog offers to use the existing template,
put the entire description in Root, or cancel. The switch and the description travel
together when the node is copied.

Choose **Instantiate here** next to **Paste here** on the board. A marked description opens
with its variables and optional sections. An unmarked description with `${...}` variables
opens with the entire Markdown description as Root. Each template in the clipboard is
filled in turn. The board creates the copies after the final confirmation, with the filled
descriptions ready to edit as Markdown. Descriptions without a template paste as written.
**Cancel** abandons the paste.

## Built-in templates

The menu highlights **AI** or **Human** for the task's type until a template is chosen.
Non-task types and read-only tasks have no template menu.

On first board use, missing defaults are seeded once. After that they are ordinary store
files: customizations remain and deleting one does not recreate it. The AI root is:

```text
${noCode}
${colleague}
${flowNodeDescription}
${commit}
```

The three clauses are optional sub-templates with empty `defaultText`:

| Clause | Instruction |
| --- | --- |
| No code | Explain architecture and approach in plain language; include code only as needed |
| Colleague | Use the tone of a colleague's Teams message |
| Commit | Commit completed work without pushing |

The Human template contains only `${flowNodeDescription}`.

## Instantiation

When applying a template file, `${flowNodeDescription}` and `${flowNodeTitle}` come live
from the task draft. Other answers use `@kiao-dashboard-kit/template-fields`, shared with
the template editor and retained across reloads in the browser tab.

Choosing a template opens a panel over the currently displayed central host, with inputs on the
left and rendered Markdown on the right. Its Instantiate action replaces the description
through the panel's normal write path. Copy is disabled; no separate file is created.
Cancel returns to the previous panel without changing the description.

The panel has no mask or focus trap, so surrounding controls and file drops remain usable.
A stable stack ID prevents duplicate panels. The preview sees live changes to the task
behind it.

The runner reads the resulting task text.
