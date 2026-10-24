---
id: "00055"
title: "a workflow is a **workflow run**"
status: superseded
date: 2026-09-15
tags: ["hybridflow", "rename", "runs"]
components: ["worker", "dashboard", "kiao-worker"]
paths: ["operation/worker"]
symbols: ["/agents/workflow-runs/*", "AgentWorkflowRuns-ctx", "StartWorkflowRunModal", "handlers_workflow_run.go", "workflow_run_fault.go", "protocol 15"]
triggers: ["workflow vs run", "workflows panel", "protocol 15", "workflow face", "boardSpots", "WorkflowView"]
supersedes: []
superseded_by: ["00066"]
---

# 00055 — a workflow is a **workflow run**

**Decision:** what HybridFlow called a *workflow* — a set of tasks being executed, started on one
card and following the `onSuccess` links from there — is called a **workflow run** throughout. The
six endpoints move from `/agents/workflow/*` to `/agents/workflow-runs/*`, the service-scoped socket
frame `workflow` becomes `workflowRun`, the `hello` list `workflows` becomes `workflowRuns`, and the
name a notice attributes itself to moves from `notice.workflow` to `notice.workflowRun`. Protocol
version 15. In Dashboard the tool bar tab **Workflows** becomes **Workflow runs**
(`hybridflow-ui-workflows` → `hybridflow-ui-workflow-runs`), `AgentWorkflow-ctx` becomes
`AgentWorkflowRuns-ctx`, and `StartWorkflowModal` becomes `StartWorkflowRunModal`. In
worker `agents/handlers_workflow.go` becomes `agents/handlers_workflow_run.go` and
`agents/workflow_fault.go` becomes `agents/workflow_run_fault.go` — which is what the two
2026-08-27 entries above point at under their old names.

**Why:** the word was doing two jobs. A board already *has* a workflow — the third face, the chains
drawn as arrows between cards, written on each card as its `spot` — and that workflow is a shape
that sits there whether or not anything is playing. Calling an execution of it by the same word made
every sentence about either one ambiguous: "the workflow ended" and "the workflow is empty" are
statements about two different things, and the panel listing executions was the *workflows* panel
next to a face called *Workflow*. A run of a workflow is a workflow run, which is what the rest of
the code had already settled on — `WorkflowRunner`, `workflowRun`, `AgentWorkflowRunDto`, the
`runId` every endpoint takes. This finishes that word rather than introducing it.

**What keeps its name:** the workflow itself — the `workflow` face of a board, `WorkflowView.tsx`,
the geometry in `boardSpots.ts` and `taskSpot.ts` — and the `.workflow.json` document format with
its `KiaoWorkflow` doc type, `WorkflowTask`, `WorkflowColumn` and the `kiao-workflow-*` clipboard
kinds. Those describe the set of tasks, not an execution of it. `WorkflowRunner` also keeps its
name: it is what owns the runs, not one of them.

**Clean break, no aliases.** The three halves — worker, `kiao-worker`, Dashboard — ship
together, and a tab built against another `hello.protocolVersion` is already told to reload, so the
old routes and the old frame are simply gone rather than served beside the new ones. Nothing is
persisted under the old names except the tool bar tab id in `dashboard-view-state.json`, and a bar
whose selected tab is no longer registered already falls back to the first one it holds
(`activeTabIn`).

## Refactor notes

Status superseded: executions are chain runs (00066). Rationale stands as history.
