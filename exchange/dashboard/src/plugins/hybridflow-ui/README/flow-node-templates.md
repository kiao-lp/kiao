---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Flow node templates

[Board guide](../README.md) · [Node classes](classes-and-workflows.md#node-classes)

The Node panel's task toolbar offers an Instantiate template icon immediately to the left of
Archive, available from Spec, Options and Result. Clicking it lists the templates;
choosing one opens its instantiation panel.
Templates are `.temp.md` files in the flat `kiao-user-config/flow-node-templates` folder,
edited by `template-edit` with its variables, optional sections and value providers.
The selected template lives in the panel draft.

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

`${flowNodeDescription}` and `${flowNodeTitle}` come live from the task draft, never from
form fields or the shared answers store. Other answers use `@kiao-dashboard-kit/template-fields`,
shared with the template editor and retained across reloads in the browser tab.

Choosing a template opens a panel over the currently displayed central host, with inputs on the
left and rendered Markdown on the right. Its Instantiate action replaces the description
through the panel's normal write path. Copy is disabled; no separate file is created.
Cancel returns to the previous panel without changing the description.

The panel has no mask or focus trap, so surrounding controls and file drops remain usable.
A stable stack ID prevents duplicate panels. The preview sees live changes to the task
behind it.

The runner reads the resulting task text and knows nothing about these templates. Class
versions in template mode use the same panel, writing the result into new instances.
