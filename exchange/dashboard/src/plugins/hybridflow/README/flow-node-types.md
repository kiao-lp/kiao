---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Flow node types

[Board guide](../README.md)

The canvas creates the node kinds below. AI and Human task menus offer conversion to
the other task kind.

| Type | Purpose | Main fields |
| --- | --- | --- |
| AI | Work performed by an agent | Description, criteria, settings, chat, successor and chat handoff |
| Human | Work performed by a person | Description, criteria, optional folder and successor |
| Start | Begin a chain run | One optional successor, no predecessor |
| Shutdown | End execution by shutting down the runner machine | No settings or successor |
| Scheduler | Wait before continuing | Positive duration or local datetime, successor |
| Bitbucket PR Status | Wait for a Bitbucket Cloud pull request status | Pull request ID, target status, successor |
| Bitbucket Commit Status | Wait for a Bitbucket Cloud commit's build status | Commit ID, target status, successor |
| Parallel gateway | Join incoming branches and start outgoing branches | Successor list |
| Exclusive gateway | Continue on each arrival or choose a branch with CEL | Linked successors and optional CEL routes |
| Limiter | Choose a successor according to whether any passes are left | Maximum passes, remaining passes and two ordered successors |
| Note | Display Markdown on the canvas | `note`; no execution or successor |
| Value | Hold JSON, optionally typed by a schema value | `value`, `valueType`; no execution or successor |
| Role | Define a role and who fills it | Name, `roleId`, `description` and `people` |

The store gives each AI and Human flow node a task row. The API includes the task fields in
its flat flow node object.

## Value references in node fields

Use `{{input.field}}` for a predecessor's output, `{{currentWorkflow.field}}` for a shared
workflow value and `{{role.ID}}` for the people in a Role flow node. A field can combine literal text
and references, for example
`workspace/repository#{{input.pullRequestId}}`. The editor saves the expression as written.
Card titles on the canvas show available values and retain unresolved references.

| Type | Fields that read references |
| --- | --- |
| AI | Description, success criteria, working directory and title when it supplies the prompt |
| Human | Title, description and success criteria in the Work panel, and the working directory link |
| Scheduler | Duration and local date and time |
| Bitbucket PR Status | Pull request ID and target status |
| Bitbucket Commit Status | Commit ID and target status |
| Note | Markdown showing shared workflow values and role references |

For a date time reference, choose **Date time from a value** under **Schedule mode**. For a
Bitbucket status reference, choose **Use a value reference** under **Target status**. The runner
validates the resulting value when the flow node runs. A missing reference or invalid result in
an execution field stops the chain. Human instructions and Notes show unresolved references.
A continued AI conversation requires the resolved directory to match the source conversation.
Exclusive gateway conditions read `input`, `currentWorkflow` and `role.ID` directly in CEL.

## Role flow nodes

Choose **New Role** on the canvas. Enter the name displayed below the actor symbol and a **Role ID**.
Use **Description** for an optional short summary. Enter one person per line in **People** using
plain text such as `"Alex Rivera" <alex@example.com>`.
Role flow nodes provide board-wide data for reference expressions.

A role is available across its board. The ID is case-sensitive, unique among active Role flow nodes,
and can contain letters A–Z, digits, underscores and hyphens. For the ID `reviewers`,
`{{role.reviewers}}` inserts the people in their saved order, separated by commas. An empty
people list inserts an empty string. In CEL, use bracket notation for an ID such as
`role['release-reviewers']`. A cloned Role flow node keeps its description and people and starts with a blank ID.
Pasting a Role flow node requires its ID to be available on the destination board.

## Type conversion and compatibility

The type controls visible fields and normalization. Converting away from AI removes turn
settings and runner, resets transition to `end` and clears compaction. Converting away from a
task also removes folder. Shutdown and display nodes lose successors. Gateways store branches in
`flowNodes`. Stored conversations are kept
as history even when the new type hides them.

Converting a flow node to AI retains an explicit agent selection. Choose any missing agent, effort,
permission and folder in its [settings](settings.md). Canvas creation asks for the agent.

Legacy input with no recognized type infers AI from an agent or model, otherwise Human. Human
is omitted on write. This reading rule is independent of canvas creation's AI default
(`NEW_FLOW_NODE_TYPE`); it must not convert older manual work into agent work.

## The Start event

Choose **New Start** on the canvas and link the first step under **On success**. Press **Play** on
the Start event to prepare any configured workflow files and hand execution to the linked step.
With no successor, the run ends at Start. The API type is `start`.
[Workflow guide](workflows.md)

## The Shutdown flow node

`"type": "shutdown"` has no prompt, settings, folder or successor. It is reached through a
successful chain, so failed or stopped work leaves the machine running.

The runner executes `KIAO_WORKER_SHUTDOWN_COMMAND` when configured. The command-line launcher
can supply it; other deployments may not. The editor keeps the node visible everywhere so
opening a board cannot erase a shutdown configured elsewhere. If the runner cannot perform
the command, the node becomes `error`, not `done`.

## The Scheduler flow node

`"type": "scheduler"` has two mutually exclusive modes:

- **Duration:** `"duration": "1h30m"`, counted from each play. Positive hours, minutes,
  seconds and milliseconds can be combined.
- **Date time:** `"at": "2026-10-16T22:00"`, interpreted in the runner machine's local timezone.
  A past time continues immediately. Moving the board preserves wall time, not an instant.

Without valid timing it is incomplete. It has no description, settings or conversation.
An eligible Scheduler can start a named run directly or be reached through a chain.
Stop during the wait cancels it without playing the successor.

## Bitbucket PR Status

Create a **Bitbucket PR Status** event from the canvas menu. Enter a pull request number such
as `42` for the runner's default repository, or `workspace/repository#42` for a specific
repository. Choose `OPEN`, `MERGED`, `DECLINED` or `SUPERSEDED` and link the successor.

The runner checks the PR as soon as the run reaches the event and every 30 seconds while it
waits. The first matching response completes the event and continues the chain. Stop
interrupts the wait. The API type is `bitbucket-pr-status` with `pullRequestId` and
`pullRequestStatus` fields.

## Bitbucket Commit Status

Create a **Bitbucket Commit Status** event from the canvas menu. Enter a Git hash of 7 to 40
hexadecimal characters for the runner's default repository, or use `workspace/repository@hash`.
Choose `INPROGRESS`, `SUCCESSFUL`, `FAILED` or `STOPPED` and link the successor under **On success**.

The runner checks immediately and then every 30 seconds. A failed build takes precedence, followed
by an in-progress build and a stopped build. `SUCCESSFUL` requires all reported builds to succeed.
An empty build list keeps the event waiting. The first match continues the chain. Stop interrupts
the wait. The API type is `bitbucket-commit-status` with `commitId` and `commitStatus` fields.

## Worker credentials for Bitbucket events

Create `atlassian.json` in the worker's state directory (`KIAO_WORKER_STATE_PATH`).
It defaults to `<dcms-root>/.kiao-config`. The worker reads the file at the start of each event.

```json
{
  "bitbucket": {
    "workspace": "workspace-slug",
    "repository": "repository-slug",
    "token": "<Bitbucket access token>"
  },
  "confluence": {
    "email": "user@example.com",
    "token": "<Confluence API token>"
  }
}
```

Grant **Pull requests → Read** for PR status and **Repositories → Read** for commit status.
For a Bitbucket API token, add the Atlassian account's `email` to the `bitbucket` section and grant
`read:pullrequest:bitbucket` for PR status or `read:repository:bitbucket` for commit status.
The `workspace` and `repository` defaults are used for bare PR numbers and commit hashes. The
`confluence` section is optional and holds separate credentials for Confluence.
[Bitbucket access tokens](https://support.atlassian.com/bitbucket-cloud/docs/repository-access-token-permissions/),
[Bitbucket API tokens](https://support.atlassian.com/bitbucket-cloud/docs/using-api-tokens/),
[Bitbucket commit statuses](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-commit-statuses/#api-repositories-workspace-repo-slug-commit-commit-statuses-get),
[Confluence API tokens](https://developer.atlassian.com/cloud/confluence/basic-auth-for-rest-apis/).

## Gateways and limiter

### Parallel gateway

A parallel gateway waits for every incoming branch, then starts its listed successors in parallel.
When a chain reaches it again, each incoming branch must have completed since it last fired.

```json
{
  "id": "gateway-1",
  "title": "Both done?",
  "type": "gateway",
  "onSuccess": { "flowNodes": ["task-2", "task-3"], "mode": "end" }
}
```

Incoming branches are nodes naming the Gateway as successor. It has no description, settings,
chat handoff or compaction. Its panel multi-select removes branches; drawing a canvas chain
adds one. Each outgoing branch has an arrow and runs independently. A Gateway with no outgoing
branches still joins its incoming branches. Start and Stop for it belong to the runs panel.

### Exclusive gateway

To join paths that can finish independently, link them to an **Exclusive gateway** with one
successor and an empty route list. Each arrival activates that successor and passes along any
JSON from the predecessor that just completed. If another run is playing the successor, the
arrival waits until it can claim the successor.

For conditional routing, connect the possible successors on the canvas or choose them in
**Linked successors**. Use **Add route** to enter a CEL condition
such as `input.approved == true` or `currentWokflow.approved == true`, then choose its linked
successor. Drag the route handles to set evaluation order.

The first true condition chooses one branch and passes any incoming JSON to it. Put `true` last
for a default path. Route evaluation needs predecessor JSON, a workflow or a named role on the board.
An invalid condition or no match sets the gateway to `error`.

### Limiter

Create a **Limiter** and choose a successor for each branch, **Passes left** and **No passes left**.
The board marks the limiter as incomplete until both successors are available.
**Maximum passes** starts at one. When passes are available, the limiter follows **Passes left**
and consumes one pass. At zero it follows **No passes left**. Set the maximum to zero to
start on **No passes left**.

The card shows how many passes are left. Changing the maximum or clicking
**Reset counter** refills the counter to the maximum. You can play the limiter again after
it completes. Each selected branch receives any incoming JSON.
