---
status: DRAFT
role: PRIMARY_SOURCE
---

# Structured task data

An AI or Human task can name a JSON Schema value as its `outputType`. The value can belong to any
board. `GET /schema-values` lists available schema values with their board names; the worker
proxies the catalogue and MCP exposes it as `board_schema_values`. An empty `outputType`
disables export.

The runner reads and compiles the selected schema at the start of the task. It appends explicit
instructions to the prompt: the final message must contain exactly one fenced block labelled
`output`, containing JSON that matches the supplied schema. For example:

````markdown
```output
{
  "message": "hello"
}
```
````

Only the final response block is read for export. Earlier progress messages and tool results
cannot supply it. Missing, incomplete, duplicate, invalid JSON or schema-invalid exports mark
the task as an error and stop its chain. Interrupted and failed turns do not export data.
Untyped tasks retain ordinary completion behavior. Schemas default to draft 2020-12; supported
explicit drafts and local `$ref` definitions work without fetching files or network resources.

The runner supplies the validated JSON to the store's `/played` call. PostgreSQL writes the
`output` and completion status in the same conditional update that releases the run's claim.
A late completion from another run cannot replace it. A new claim clears a previous output;
changing the node type or output schema clears it too. The worker's spool preserves exports
with completion records and exposes the same result in its cached board during an outage.

Successors receive data independently of conversation handover or compaction. Before sending
an AI task, the runner replaces placeholders in its description, title fallback and success
criteria:

| Placeholder | Result |
| --- | --- |
| `{{input.message}}` | The predecessor's `message` string. |
| `{{input.person.name}}` | A nested property. |
| `{{input.items.0}}` | An array element. |
| `{{input}}` | The whole JSON value. |

Strings are inserted directly; other values use JSON syntax. Replacement is one pass, so
placeholder-like text in a received string stays data. Missing input or a missing field marks
the task as an error before spending a turn. Only outputs from completed, visible predecessors
are read. A task played directly can use its predecessor's last successful output.

Schedulers pass their predecessor's output through. A Gateway with one predecessor passes
that value through; a join exposes an array of predecessor outputs in board order, with `null`
for a branch with no export. A successor can read `{{input.0.message}}`. An entirely untyped
join has no input. Every outgoing branch receives the Gateway's stored output.

Dashboard edits `outputType` in both task editors and displays the last exported JSON. The
description on the board keeps its placeholders; interpolation changes only the sent prompt.
Deleting a referenced schema leaves its id on the task, making the missing type visible and
refusing its next play. A schema used by an output cannot be retyped as an ordinary value.

A Human task whose predecessor finishes is set to `todo` (label: To do). A Human task in
`todo` or `running` (label: In progress) shows a Work button. It opens the WorkOnTask panel
on the central area stack: description, success criteria, and an editor for the output.
Opening the panel from `todo` sets the task to `running`. With an `outputType`, the editor
is JSON and Submit requires JSON matching the schema. Without one, the editor is raw text
and the output is stored as a JSON string. Submit sets the task to `done`, stores the
output, and sets a Human successor to `todo`. A successor task reads the output with the
placeholders above, as it reads an AI task output.
