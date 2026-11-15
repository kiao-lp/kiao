---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Node classes and versions

Read to reuse tasks or chains, manage versions or instantiate definitions.
[Operations](operations.md) covers revisions and deletion; [templates](reuse/templates.md)
distinguishes class templates from editor description templates.

## Node classes

A node class is a reusable definition filed on one board and instantiated on any board.
It separates shared configuration from versioned wording and local instance settings.
`class_list` discovers definitions across boards; `class_get` reads one and its versions.

| Class field | Rule |
|---|---|
| `id`, `revision` | Stable UUID and revision for conditional class patches. Versions have their own revisions. |
| `title` | Required name. |
| `instantiable` | Offer in Dashboard's Instantiate menu; false by default. |
| `type` | `human`, `ai`, `shutdown` or `scheduler`. Gateways, Notes and Values have no classes. |
| `tags` | Words copied to instances. |
| `at`, `duration` | Alternative Scheduler presets; see [Schedulers](chains.md#schedulers). |
| `permission`, `runner` | AI instance defaults. |
| `onSuccess` | Next **class** id and AI conversation options; see [chaining classes](#chaining-classes). |
| `note` | Guidance about using the class; copied to no instance. |
| `spot` | This class's board position; `clearSpot: true` clears it. |
| `workflowClass` | This board's workflow class id; `""` removes membership. |
| `versions` | Read response: versions in ascending number order. |

A class has no folder, effort, conversation, output schema or body of its own. `class_create`
can take `body`, `criteria`, `template` and default `agent` to create the **first version** at
once; `published: true` freezes that version at creation. `class_patch` changes only class
fields. Update wording by creating or editing a draft version.

`board_card_to_class` converts an AI or Human task to a reusable definition: title, type and
shared configuration become class fields, and description and criteria form the first version.

## Versions

| Version field | Rule |
|---|---|
| `id`, `number`, `revision` | Service-assigned identity, successive number and independent edit revision. |
| `body`, `criteria` | Task description and success criteria. |
| `template` | Instantiation fills this version's body instead of copying it. |
| `agent` | Default managed agent id for AI instances. |
| `status` | `draft` or `published`. Only a draft is editable. |

`class_create_version` creates a blank draft or copies the version named by `from`.
`class_patch_version` edits a draft or publishes it. Publishing is irreversible: no edit,
including a return to draft, is accepted on a published version. New wording needs a new version.
Instantiating selects the latest published version; a class without one cannot instantiate.
`class_delete_version` permanently removes one version.

## Instantiation

`class_instantiate` makes a card for the class and each successor, using each one's latest
published version. Its `handle` selects the **destination** board, which may differ from the
source. `spot` optionally places the head; omit it to let Dashboard place unplaced cards.
`bodies` supplies filled template text by **class id**; versions without `template` copy their body.

An AI instance receives its version's agent, class permission and optional runner, but no effort
or folder. Set those locally and verify that the agent is active and published. Classes and
versions have no `outputType`; select output schemas on task instances, including Human tasks.
Input placeholders in version wording are resolved at execution time, not instantiation time;
see [structured data](structured-data.md).

An instance remembers its class version in the read-only `classVersion` object:
`{classId, classTitle, versionId, versionNumber}`. To change that binding, patch `classVersion`
with a version id; `""` detaches it. Binding an instance is separate from editing the version.

## Chaining classes

A class names the next **class**, never a version or card, in `onSuccess.flowNode`.
`class_chain` changes only that link; an empty target unlinks. Instantiation follows class
successors and remaps them to the new card ids. AI class `mode` and `compact` define instance
conversation behavior as described in [chains](chains.md#on-success). Patching `onSuccess`
replaces the object, so preserve its other fields.

For grouping cards or classes and instantiating a reusable group, read
[workflows and workflow classes](reuse/workflows.md).
