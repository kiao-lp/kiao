---
name: hybridflow
description: Design and edit hybridflow boards and workflows, including tasks, agents, runners and reusable classes. Use for human steps, branching, waits, JSON Schema values and task handoffs, or retired .workflow.json boards.
---

# Hybridflow

Use this entry point to design the workflow, then read only the references needed to build it.
The references define the same behavior for MCP and HTTP.

A **board** holds cards on a canvas. AI and Human cards are **tasks**; the other cards control
execution or display information. Success links determine execution order. Placement, tags
and **workflow** groups organize the view. A workflow group does not start or order its members.
Boards are persisted by hybridflow-store and edited through its API; `.workflow.json` files
are retired.

## Design the skeleton

Start with the intended result and what proves it complete. Divide the work into tasks when
responsibility, working folder, required information or completion criteria change. Give each
task a clear request and observable success criteria; its title alone rarely expresses enough.

Choose the capabilities that serve that result:

| Need | Capability and benefit | Constraint or tradeoff |
|---|---|---|
| Delegate work | **AI task**, with a selected agent, effort, permissions and working folder | It needs complete execution settings and an available agent on the runner. |
| Have a person decide or contribute | **Human task**, with instructions, criteria and a submitted result | Reaching it ends the current run. Dashboard can start a ready successor on submission; plan that boundary. |
| Delay work | **Scheduler**, for a duration from each start or a particular local datetime | It is a single wait; it does not repeat a workflow. It carries data but no conversation. |
| Run independent branches or wait for all results | **Gateway**, which starts all outgoing branches after all incoming branches finish | It is an AND join and split. It neither selects a branch by a condition nor continues after a failed branch. |
| Turn off the runner machine after successful work | **Shutdown**, as the final step | It needs a configured shutdown command. Failure or interruption earlier in the chain leaves the machine on. |
| Explain the board | **Note**, for Markdown and links | Display only; it does not run or supply task input. |
| Keep JSON or define a shared data contract | **Value**, optionally typed or used as a JSON Schema | Display only; placing it near a task does not transfer its value to that task. |

Tasks and Schedulers each have at most one predecessor and one successor. Shutdown has at most
one predecessor and no successor. Use Gateways for multiple links; Notes and Values have none.
Links stay within a board. Do not model repetition with cycles: a run stops at a card it has
already played. Success links are followed after successful completion; define recovery for
errors and interruptions separately from the successful path.

### Design information flow alongside execution order

Identify what each consumer needs from earlier work: artifact paths, exact revisions, decisions
or validation results. Distinguish these results from instructions and files available to every
task independently. Where a later decision depends on a result, use a minimal structured output
contract and consume the required fields explicitly. Independent tasks need no artificial contract.

Trace each required result across Human tasks, waits and joins. A Human task submits its own
result; it does not automatically forward earlier machine results. Preserve those explicitly,
for example by reading the named producer's stored output. Read the
[task data reference](references/structured-data.md) when implementing any such dependency.

Conversation continuity is a separate choice. By default, the next AI task uses its own
conversation. Continuing forks the preceding AI conversation and keeps its context, but requires
the same working folder. Native session continuity depends on the harness. Compaction saves
context at the cost of detail. Neither conversation history nor a shared folder identifies which artifact a
validation approved; structured results can pass even when conversations end.

### Useful patterns and their limits

- **Produce → validate → act:** pass the artifact identity and verdict, then verify that the
  action uses the validated artifact. A successful validation task can still report a negative
  verdict; a success link alone does not test that verdict.
- **Prepare → Human decision → act:** make the requested decision explicit, preserve earlier
  results without asking the person to recopy them, and configure how execution resumes.
- **Split → independent work → join → synthesize:** parallelize only independent work; the join
  waits for every incoming branch. Agree on how the consumer identifies each branch's result.
- **Wait → work → optional Shutdown:** useful for unattended work; it provides neither recurrence
  nor cleanup after failure.
- **Reuse a proven task or chain:** node classes hold reusable definitions with published
  versions; workflow classes group reusable definitions. Instances still need local execution
  settings and output schemas. Description templates instead help author task wording.

## Choose the access method

The skill provides design guidance and shared reference information. The **MCP tools perform
operations**: use `kiao-hybridflow` when its tools are available and working, starting with
`board_list` and `board_get`. Tool names may have a server prefix. Their schemas describe call
arguments; the references below explain the behavior those arguments configure.

If MCP is absent or its transport is unavailable, use the [HTTP fallback](references/api-curl.md)
when its connection and credentials are available. A validation or revision error needs repair,
not another transport. After an uncertain write, read the board before retrying. A missing backend
can affect both access methods. If neither works, report the access problem; a local board file
cannot apply the change.

## Find the implementation detail

Before any write, read [operations](references/operations.md) for identities, revisions,
replacement fields and verification. For other needs, follow the relevant row only.

| Need or trigger | Read | MCP tools to discover |
|---|---|---|
| Find, create, rename or inspect a board; resolve a conflict | [Operations](references/operations.md) | `board_list`, `board_get`, `board_create`, `board_patch` |
| Create, configure, position or mark cards; write task instructions | [Cards](references/cards.md) | `board_add_cards`, `board_get_card`, `board_patch_card` |
| Link tasks, branch, join, continue context, wait or shut down | [Chains](references/chains.md) | `board_chain_card`, `board_patch_card` |
| Transfer results, define schemas, consume inputs or preserve data across a Human step | [Structured data](references/structured-data.md) | `board_schema_values`, `board_add_cards`, `board_patch_card`, `board_get_card` |
| Select or configure an agent; publish, archive or inspect its history | [Agents](references/execution/agents.md) | `agent_list`, `agent_get`, `agent_create`, `agent_patch`, `agent_publish`, `agent_versions` |
| Choose the machine that executes an AI task | [Runners](references/execution/runners.md) | `runner_list`, `runner_get`, `board_patch_card` |
| Reuse tasks or chains, publish versions or instantiate | [Node classes](references/classes.md) | `class_*`, `board_card_to_class` |
| Group cards or classes; instantiate a reusable workflow | [Workflow groups](references/reuse/workflows.md) | `workflow_*`, `workflow_class_*` |
| Apply description templates or distinguish them from class templates | [Templates](references/reuse/templates.md) | `board_add_cards`, `board_patch_card` |
| Copy cards to another board or installation; prepare clipboard JSON | [Copying](references/reuse/copying.md) | `board_add_cards` |
| Archive or remove objects | [Lifecycle operations](references/operations/lifecycle.md) | `board_patch`, `board_patch_card`, the relevant `*_delete` tool |
| Inspect changes or usage; diagnose the store version | [Observation](references/operations/observation.md) | `board_changes`, `board_card_usage`, `hybridflow_schema` |
| Diagnose access or operate without working MCP tools | [HTTP fallback and endpoint map](references/api-curl.md) | Tool-to-endpoint map |

Preparing cards and starting them are separate operations. Leave configured cards ready for
Dashboard Play; execution, run claims and completion belong to the runner.
