---
id: "00058"
title: "a board's cards are flow nodes, not tasks"
status: accepted
date: 2026-09-17
tags: ["hybridflow", "rename", "board"]
components: ["hybridflow-store", "worker", "dashboard"]
paths: ["kiao-user-config/flow-node-templates"]
symbols: ["flow_node", "/boards/{handle}/flow-nodes", "flowNodes", "flowNodeId", "docTypeVersion 3", "V009", "V011", "V013", "${taskDescription}", "${taskTitle}"]
triggers: ["task vs flow node", "Shutdown", "Scheduler", "Human card", "task-templates", "clipboard kind", "wire break"]
supersedes: []
superseded_by: []
---

# 00058 — a board's cards are flow nodes, not tasks

**Decision:** the thing filed on a hybridflow board is a **flow node** everywhere — the entities and
services of `hybridflow-store`, its `flow_node` table, the `/boards/{handle}/flow-nodes` routes and
the `flowNodes` / `flowNode` fields of its wire, the `workflow-run` protocol worker publishes
(`flowNodeId`, `rootFlowNodeId`, `flowNodes`), the `hybridflow-ui` plugin down to its file names and
its tool-bar tab, the `hybridflow` skill, and the store's own `.workflow.json` files and
`kiao-user-config/flow-node-templates`. **Why:** "task" said *a unit of work in a queue*, and that
is neither what the row holds nor how anything reads it. A board is a graph — a card names the card
played after it, a chain runs across columns without noticing them — and three of the four kinds
(Shutdown, Scheduler, and a Human card waiting on somebody) are not work to be done at all. The word
was carried over from the `.tasks.md` columns the format replaced, and every layer since has been
written around it.

**The old word survives in exactly two places, and both are records rather than code:** the schema
history (`V009__task-is-a-flow-node.sql`, which renames the table, its constraints, its indexes, its
triggers and the change log's own column and `scope` value, converting the rows already in the log),
and the store migration (`V013__workflow-tasks-are-flow-nodes.js`, which renames the keys in the
`.workflow.json` files left in a tree and moves `kiao-user-config/task-templates` with the
`${taskDescription}` / `${taskTitle}` variables inside it). Both rename in place — a key keeps its
position, a constraint keeps what it constrains — so a rewritten board differs from the one before
it in the spelling and in nothing else, and a second run is a no-op.

**The wire broke on purpose, on both sides at once.** `hybridflow-store`, worker and Dashboard
are built and deployed together, and a compatibility shim reading both words would have been the one
trace of the old design that never goes. The document format says `docTypeVersion: 3` for the same
reason: a reader that met `tasks` would keep the word alive in every board nobody has opened.

**The word came back, for the thing it was always right about.** A **task** is a flow node that is
work somebody does — an AI card an agent plays or a Human card a person does — and since
`hybridflow-store`'s `V011` it is a table of its own, keyed by the flow node it belongs to, holding
everything a Shutdown and a Scheduler have no answer to. That is not this decision reversed: what
was wrong was calling *every* card a task, and what was missing was any word at all for the pair
that constantly had to be named as "an AI or a Human flow node". Freeing the word is what made it
available for the case it fits. See
[the schema document](/operation/hybridflow-store/docs/solution-design/schema.md).

## Refactor notes

See also the hybridflow-store schema document for the V011 task table.
