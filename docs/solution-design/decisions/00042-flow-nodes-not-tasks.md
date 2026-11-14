---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-17
tags: ["hybridflow", "rename", "board", "hybridflow-store", "worker", "dashboard"]
triggers: ["task vs flow node", "Shutdown", "Scheduler", "Human card", "task-templates", "clipboard kind", "wire break", "flow_node", "/boards/{handle}/flow-nodes", "flowNodes", "flowNodeId", "docTypeVersion 3", "V009", "V011", "V013", "${taskDescription}", "${taskTitle}"]
supersedes: []
superseded_by: []
---

# 00042 — Board cards are flow nodes on every layer.

## Context and Problem Statement

A board is a graph whose successor links run across columns, not a task queue.
The inherited `.tasks.md` terminology calls every card work, including Shutdown,
Scheduler and Human cards waiting on someone.

## Considered Options

* Name every board card a flow node and reserve task for work-bearing nodes.
* Keep calling all cards tasks.
* Read both old and new names through a compatibility layer.

## Decision Outcome

Chosen option: "Name every board card a flow node and reserve task for work-bearing nodes",
because the graph needs a common name for all kinds and a distinct name for AI or Human work.

Use flow node across hybridflow-store entities and services, table `flow_node`,
`/boards/{handle}/flow-nodes`, wire `flowNodes` / `flowNode`, worker's `workflow-run`
fields `flowNodeId`, `rootFlowNodeId` and `flowNodes`, the `hybridflow-ui` plugin,
toolbar and filenames, the `hybridflow` skill, `.workflow.json`, and
`kiao-user-config/flow-node-templates`.

The three services build and deploy together, so the wire changes without a dual-name shim.
`docTypeVersion: 3` prevents old `tasks` keys from persisting through permissive reads.

Since schema V011, a task is the work-bearing subset—AI or Human—with its own table keyed
by flow node. Shutdown and Scheduler data remain outside it.

## More Information

Frozen `V009__task-is-a-flow-node.sql` renames the table, constraints, indexes, triggers,
change-log column and `scope`, including existing log rows.
`V013__workflow-tasks-are-flow-nodes.js` renames document keys and
`kiao-user-config/task-templates`, including `${taskDescription}` / `${taskTitle}`.
Both preserve positions and constraints and become no-ops on repetition.
The [schema document](/operation/hybridflow-store/docs/solution-design/schema.md) describes
the V011 task table.
