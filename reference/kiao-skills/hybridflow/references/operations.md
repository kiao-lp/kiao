---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Board operations

Read before changing a board through either MCP or HTTP. Field details are in [cards](cards.md);
HTTP connection setup and request envelopes are in [api-curl](api-curl.md).

## Identity and discovery

List boards and match the requested name. Use the returned `slug` or board `id` as the handle;
both are accepted. A rename changes the name and leaves the slug stable. If the requested board
is missing, report the available boards rather than silently choosing or creating a similar one.
Board names must be free when creating or renaming.

Read the board before editing. It returns `board`, `flowNodes`, `flowNodeClasses`, `workflows`,
`workflowClasses` and a change `cursor`. Use these actual ids, revisions and positions.
`board_get_card` is a smaller refresh when the card id is already known. Card and class ids are
stable UUIDs; moving an object changes its position, not its identity. Let creation mint ids unless
creating a batch whose internal references require ids chosen in advance. Avoid collisions.

The Dashboard route `/boards/<slug>` identifies the board. Its attachments live under the store
link `/boards/<slug>/`; this folder contains assets, not the board definition. A rename leaves
these links valid. Archiving changes a flag and writes no board file.

## Write only the intended change

Patches name the fields to change; omitted fields stay unchanged. Unknown card fields and unknown
nested configuration fields are refused. Never copy a whole read response into a write: it includes
read-only fields. Preserve supported extension settings under `settings.extra`.

| Supplied field | Update behavior |
|---|---|
| `settings`, `tags`, `criteria`, `onSuccess` | Whole replacement. Read the current value, change what is needed, and preserve its other entries. |
| `onSuccess.flowNodes` | Whole Gateway branch list when patching `onSuccess`. The link-only operation instead adds one branch. |
| `clearSpot: true` | Clear a card or class position. |
| `clearComplexity: true` | Clear a task estimate. |
| `workflow: ""`, `classVersion: ""`, `workflowClass: ""` | Remove the respective membership or class-version binding. |
| `outputType: ""` | Disable a task's schema selection and clear its saved output. |

Make a write derived from a read conditional on that object's revision: `ifMatch` in MCP,
`If-Match` in HTTP. A `409` requires a new read and a fresh decision; it can indicate either a
changed revision or an object held by a run. Do not retry the stale payload blindly. The link-only
and bulk-delete operations have no revision argument; read back their results when concurrent
changes matter.

Distinguish a failed call from an uncertain result. After a timeout or broken connection during
a write, inspect the current state before retrying, especially for creation and instantiation.
MCP and HTTP reach the same state; switching transport does not resolve a domain error.

## Preserve execution ownership and authored work

- Configure cards in `draft`, use `blocked` for an external dependency, and offer complete cards
  as `ready`. `todo` identifies a Human task awaiting work. See [card states](cards.md#status-and-chat).
- Leave `run`, `chat`, successful `output` and the held states `running` and `waiting-refresh`
  to execution. Human work can also enter `running` through Dashboard's WorkOnTask panel.
- Start execution with Dashboard Play. Do not call `/play`, `/played` or `/settle` manually;
  those routes manage run claims and completion. MCP deliberately exposes none of them.
- A type change can discard fields the new type does not support. In particular, converting a
  task to a control card loses its description and criteria. Establish that this loss is intended
  before replacing authored work; use a separate card when both meanings are needed.

## Verify the result

Read the changed board or objects back. Check task settings, success criteria, link cardinality
and intended grouping. Before declaring a chain ready, trace each required result from its
producer to its consumer: schema ids resolve, consumer fields exist, and Human steps, waits and
joins preserve the required information. State the important handoffs in the completion report,
or briefly explain why the tasks have no result dependencies. Leave starting Play to the user.

For archiving or permanent removal, read [lifecycle operations](operations/lifecycle.md).
For change feeds, usage and the migration ledger, read [observation](operations/observation.md).
