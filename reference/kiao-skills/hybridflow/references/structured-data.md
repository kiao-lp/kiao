---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Structured task data

Read when a task needs results produced earlier, or when creating typed JSON values and schemas.
These fields and contracts are shared by MCP and HTTP. [Operations](operations.md) covers safe
patches; [chains](chains.md) describes execution order and conversation options.

## Choose the handoff

Identify the fields each consumer needs, including artifact identity, revision and verdict when
acting on validated work. Use a minimal schema for results that drive later decisions. Shared
folders and conversation history provide context, but cannot identify the exact result approved.
Independent tasks need no output schema merely because they are linked.

Trace the result through every intervening step. Immediate predecessor input and an earlier
producer's stored output are different access paths. Use predecessor placeholders for direct
handoffs; when a Human step or other task replaces that input, instruct the later AI to read
the named producer's `output` with `board_get_card` (or the equivalent HTTP read). Check its
completion and expected artifact identity. Do not make the person recopy machine results.

## Schema values

A schema is a Value card. This is the card object, placed in `flowNodes` for creation:

```json
{
  "title": "Validation result",
  "type": "value",
  "valueType": "json-schema",
  "value": {
    "type": "object",
    "properties": {
      "revision": { "type": "string" },
      "approved": { "type": "boolean" }
    },
    "required": ["revision", "approved"],
    "additionalProperties": false
  }
}
```

Keep the returned id. The schema and task use different type fields:

| Field | Meaning |
|---|---|
| Value `valueType: ""` | Untyped JSON. |
| Value `valueType: "json-schema"` | The value itself is a JSON Schema. |
| Value `valueType: "<schema-id>"` | JSON typed by another schema value on the **same board**; a value cannot type itself. |
| AI or Human task `outputType: "<schema-id>"` | Export typed by a schema value from **any board**. Use the id, never an inline schema or literal `"json-schema"`. |

`board_schema_values` discovers schemas across non-archived boards and cards, with `id`, `title`,
`value`, `boardSlug` and `boardName`. Over HTTP, use `GET /schema-values`; direct store HTTP
also supports `GET /schema-values/{id}`.

The value editor diagnoses schemas against the meta-schema and ordinary values against their
selected schema. Storage checks JSON syntax and type references; successful storage alone does
not prove schema validity or value conformance. AI exports are validated by the runner, and
Human submissions by the Dashboard editor.

## Configure producers and consumers

Select or create a schema, then patch the producer's `outputType` with its id. Link the consumer
and put the fields it needs in its description or criteria. Example producer patch:

```json
{"outputType":"<schema-id>","onSuccess":{"flowNode":"<consumer-id>","mode":"end"}}
```

Example consumer patch:

```json
{"body":"Act on revision {{input.revision}} only if approved is true: {{input.approved}}."}
```

Use actual ids and the revision of each edited card. Preserve existing `onSuccess` options when
replacing that object, and respect connection limits. `outputType: ""` clears the selection.
Classes and versions have no output schema: configure it on the task instance.

## AI export contract

At task start, the runner resolves and compiles the schema, then appends it and export
instructions to the prompt. Draft 2020-12 is the default; supported explicit drafts and local
`$ref` definitions work. External files and network resources are not fetched. An unavailable
or invalid schema fails the task before a turn is sent.

The **final message** must contain exactly one complete fenced block labelled `output`:

````markdown
```output
{"revision":"abc123","approved":true}
```
````

Its payload is the JSON value matching the schema: no comments, extra wrapper or string encoding.
Objects, arrays and scalars work when allowed by the schema; prose may accompany the block.
A `json` fence, tool result or progress message cannot export data. Missing, incomplete, duplicate,
malformed or schema-invalid exports mark the task `error` and stop succession. Failed or
interrupted turns export nothing. An untyped AI task has no export requirement and does not
export a block merely because its answer contains one.

## Predecessor inputs

Before sending an AI prompt, the runner replaces input placeholders in the description (or
title fallback) and criteria. The saved card keeps its original placeholders.

| Placeholder | Reads |
|---|---|
| `{{input.revision}}` | A property. |
| `{{input.person.name}}` | A nested property. |
| `{{input.items.0}}` | An array element, indexed from zero. |
| `{{input}}` | The whole JSON value. |

Strings insert directly; other values use JSON syntax. Replacement is one pass: placeholder-like
text within received strings stays data. Missing input, a missing property or an out-of-range
index marks the task `error` before a turn. Without input placeholders, a task can run without
predecessor data. Only `done`, non-archived predecessors supply it. Direct Play can consume the
predecessor's last successful export; verify freshness when restarting part of a workflow.
A Value's payload never becomes task input merely through placement beside it.

## Data across control cards

Data passes independently of conversation `mode` and `compact`. Schedulers and single-predecessor
Gateways pass the value through. A Gateway join exposes an array in **board order**, with `null`
for any branch without an export. It has no input when no predecessor has output. Each outgoing
branch receives the Gateway's stored output and can read `{{input.0.revision}}`, for example.
Board order is not arrival order or the Gateway's outgoing branch order; establish the mapping
and recheck it after structural changes.

## Human results

Reaching a Human task marks it `todo`. Work opens Dashboard's WorkOnTask panel and moves `todo`
to `running`. With an `outputType`, Submit requires JSON matching the selected schema. Without
one, submission is raw text stored as a JSON string. A Human result is its own submission, never
an automatic copy of its predecessor's result.

Submit saves `output` and `done` and offers a Human successor as `todo`. Dashboard can start a
ready automatic successor when chat execution is available; see [Human steps](chains.md#human-steps).
The successor reads this Human output using the same input rules. If it also needs an earlier
AI artifact, name that producer explicitly in the instructions or design an explicit preserved
record. For example, after a Human approval, the action task reads both the approval input and
the validation task's stored revision rather than asking the person to paste that revision.

## Output lifetime

The read-only `output` holds the last successful result. A new play clears it, as does changing
the card's type or output schema. Do not forge it with a patch or call `/played` manually.
Deleting a referenced schema retains its missing id on the task and refuses its next play.
A schema used by outputs or typed values cannot be retyped until its references are removed.
Before reporting a workflow ready, read back schema selections, consumer fields and the complete
path of each required result, including Human boundaries and joins.
