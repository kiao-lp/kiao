---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Managed agents

Read to select, create, configure, publish or archive an agent. Task-level settings are in
[cards](../cards.md#settings); [runners](runners.md) covers machine selection. The `agent_*`
MCP tools perform these operations; HTTP equivalents are in [api-curl](../api-curl.md).

An agent names the harness, model, execution profile, standing instructions and selection
purpose used by AI tasks. A task's `settings.agent` is its managed **id**, never a harness name.

## Select an agent

Read `agent_list` before choosing an id. Match the task to the **published description** when
present. Descriptions guide selection and are never sent to turns; `instructions` are standing
orders sent beside task prompts. An unknown agent id is refused when writing task settings.
Only active, published agents can start new task conversations. Availability of the harness,
model and profile is checked on the runner.

## Fields

| Field | Rule |
|---|---|
| `id` | Service-assigned identity, used by task settings. |
| `name` | Required, unique across the store without regard to case. |
| `harness` | `claude`, `codex`, `muse` or `pi`. |
| `profileId` | Execution profile reference resolved by the runner, without credentials. Pi requires one unless a default Pi profile is configured. |
| `model` | Model identifier, or empty for the CLI default. |
| `description` | When to choose this agent. An empty string clears it. |
| `instructions` | Standing orders for turns; independent of the selection description. |
| `published` | Read-only latest immutable numbered publication, absent before the first publication. |
| `archived` | Hide from default listing and prevent new task conversations; false restores it. |
| `revision` | Used for conditional patches and publication. |

## Drafts and publications

Creation and configuration patches edit a **draft**. Publish explicitly with `agent_publish`.
Until publication, new conversations use the preceding publication or cannot start if none
exists. `agent_versions` reads the publication history, oldest first, including archived agents.

Each new conversation captures its publication: model, execution profile reference and standing
instructions persist across replays, retries and manual messages. Later edits and publications
do not replace that snapshot. Saved harness and model values remain readable even if current
adapters no longer offer them. A new configuration does not retroactively update existing chats.

Archive with an agent patch setting `archived: true`, and restore with false. Request archived
agents explicitly when looking for one omitted from the default listing. Existing conversations
retain their captured publication. Published agents cannot be deleted; archive them to preserve
history. Deleting an unpublished agent leaves tasks that name it needing another agent.
