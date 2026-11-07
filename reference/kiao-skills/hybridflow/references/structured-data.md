# Structured Data — JSON Schemas, Outputs and Inputs

Read this when creating schema values or passing JSON between tasks. The same fields work
over MCP and HTTP; the HTTP preamble and endpoints are in [api-curl.md](api-curl.md).

## Schema Values

A schema is a **value card**, with `type: "value"`, `valueType: "json-schema"`, and the
JSON Schema itself in `value`. Use `board_add_cards` to create one, or `board_patch_card`
to edit an existing value. For example, the arguments to `board_add_cards` are:

```json
{
  "handle": "major",
  "flowNodes": [{
    "title": "Message schema",
    "type": "value",
    "valueType": "json-schema",
    "value": {
      "type": "object",
      "properties": { "message": { "type": "string" } },
      "required": ["message"],
      "additionalProperties": false
    }
  }]
}
```

Keep the id returned by the create. The fields serve different purposes:

| Field | Meaning |
| --- | --- |
| A value's `valueType: ""` | Untyped JSON. |
| A value's `valueType: "json-schema"` | The value itself is a schema. |
| A value's `valueType: "<schema-id>"` | Types this value using a schema card on the **same board**. A value cannot type itself. |
| A task's `outputType: "<schema-id>"` | Types its export using a schema card from **any board**. This is the schema's id, never the literal `"json-schema"` or an inline schema. |

The value editor provides schema diagnostics: the meta-schema for a schema value, or the
selected schema for an ordinary typed value. HTTP/MCP writes check JSON syntax and type
references; successful storage alone does not prove the schema or value conforms. Task
exports are validated by the runner.

`board_schema_values` lists available schemas across non-archived boards and cards, with
`id`, `title`, `value`, `boardSlug` and `boardName`. Over HTTP, use `GET /schema-values`;
`GET /schema-values/{id}` resolves one schema directly on the store.

## Configure the Producer and Consumer

Read the board and select an existing schema or create one as above. For two AI tasks with
complete settings, use their actual ids and revisions in these `board_patch_card` calls:

```javascript
{
  handle: "major", id: producerId, ifMatch: producerRevision,
  patch: {
    outputType: schemaId,
    onSuccess: { flowNode: consumerId, mode: "end" }
  }
}
```

```javascript
{
  handle: "major", id: consumerId, ifMatch: consumerRevision,
  patch: { body: "Review this message: {{input.message}}" }
}
```

The normal connection limits apply. If the consumer already has another predecessor,
unlink that predecessor first. If the producer already has an `onSuccess`, preserve its
other settings when changing the target. Set tasks to `ready` for the Dashboard's Play button.
`outputType: ""` disables export. Node classes and their versions have no `outputType`;
configure it on the AI instance after instantiation.

## Export Contract

At task start the runner resolves and compiles the selected schema, then appends the schema
and export instructions to the prompt. Schemas default to draft 2020-12; explicit supported
drafts and local `$ref` definitions work. External files and network resources are not fetched.
A missing or invalid schema fails the task before a turn is sent.

The **final message** must contain exactly one complete fenced block labelled `output`:

````markdown
```output
{"message":"hello"}
```
````

The block contains the JSON value matching the schema, without comments, an extra wrapper
or string encoding. Objects, arrays and scalars are supported when the schema allows them.
Prose may accompany the block. A `json` fence, tool result or earlier progress message does
not export data. Missing, incomplete, duplicate, malformed or schema-invalid exports mark
the task `error` and stop the chain. Failed or interrupted turns export nothing. An untyped
task has no export requirement and does not export a block merely because it contains one.

The read-only `output` field holds the successful export. A new play clears it, as does
changing the task's type or `outputType`. Do not patch `output` or call `/played` yourself.
Deleting a schema leaves its id on tasks that reference it and refuses their next play.
A schema used to type outputs or other values cannot be retyped until those references
are removed.

## Predecessor Inputs

Before sending an AI task, the runner replaces input placeholders in its description (or
title fallback) and success criteria. The saved card retains its placeholders.

| Placeholder | Reads |
| --- | --- |
| `{{input.message}}` | The `message` property. |
| `{{input.person.name}}` | A nested property. |
| `{{input.items.0}}` | An array element, indexed from zero. |
| `{{input}}` | The whole exported JSON value. |

Strings are inserted directly; other values use JSON syntax. Replacement is one pass, so
placeholder-like text inside received strings stays data. Missing input, a missing property
or an out-of-range index marks the task `error` before spending a turn. A task without input
placeholders can run without predecessor data. Only `done`, non-archived predecessors
supply data, including when a task is played directly using a predecessor's last export.
A value card's payload does not become input simply by sitting beside a task.

Data passes independently of `onSuccess.mode` and `compact`; ending the conversation still
passes it. Schedulers and single-predecessor Gateways pass the value through. A Gateway
join exposes an array of predecessor outputs in **board order**, with `null` for a branch
that exported nothing; it has no input when no predecessor has an output. Each outgoing branch
receives the Gateway's stored output and can use `{{input.0.message}}`, for example.
A Human task whose predecessor finishes is set to `todo`. Its Work button opens the
WorkOnTask panel in the Dashboard: description, success criteria and an output editor.
With an `outputType`, Submit requires JSON matching the schema. Without one, the output
is raw text, stored as a JSON string. Submit sets the task to `done`; a Human successor
is set to `todo`, and any successor reads the output with the placeholders above.
