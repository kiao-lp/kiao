---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Task description templates

Read when authoring task wording with templates, or choosing between editor templates and
reusable [classes](../classes.md). Templates change wording; [structured data](../structured-data.md)
defines placeholders evaluated when an AI task actually runs.

## Editor description templates

Dashboard loads `.temp.md` files from the store's flat `kiao-user-config/flow-node-templates/`
folder. They use the template-lang format; consult that skill when editing template syntax.
Selecting and instantiating a template **replaces** the task description with the result.

`AI.temp.md` and `Human.temp.md` are recognized by task type. When missing, Dashboard seeds them
on first opening a board: AI wraps the description with the default standing wording (be concise,
work at the strategic level, commit without pushing), while Human keeps the description alone.
Existing store templates can differ; inspect them when matching the editor's wording.

| Variable | Value |
|---|---|
| `${flowNodeDescription}` | Current task description, so the template can wrap it. |
| `${flowNodeTitle}` | Task title. |

Templates are applied by the **editor**, not by Play. Cards created through MCP or HTTP keep the
body sent by the caller. To produce the same wording as the editor, read the relevant store
template and compose the intended body before creating or patching the card.

## Class-version templates

A class version's `template` flag instead asks for filled text during **instantiation**.
The `bodies` map supplies it by class id. Ordinary versions copy their body unchanged.
This is independent of the editor's `.temp.md` files. Instantiated input placeholders remain
in the saved body and are resolved by the runner only at execution time.
