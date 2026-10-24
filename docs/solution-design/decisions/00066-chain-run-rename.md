---
id: "00066"
title: "`workflow` is freed: a board is a board, a run is a chain run"
status: accepted
date: 2026-10-11
tags: ["hybridflow", "rename", "runs", "board"]
components: ["worker", "dashboard"]
paths: []
symbols: ["/hybridflow-runner/chain-runs/*", "ChainRunner", "chainRun", "chainRuns", "BoardContent", "BoardDetailDto", "BoardCanvas", "protocol 19", "chain-runs/", "hybridflow-ui-chain-runs"]
triggers: ["workflow word", "chain run", "board content", "run logs", "workflow-runs dir", "old path alias", "WorkflowRunner"]
supersedes: ["00055"]
superseded_by: []
---

# 00066 — `workflow` is freed: a board is a board, a run is a chain run

**Decision:** the word *workflow* is taken out of every place it meant *board* or *execution*,
so it can later name what it should have named all along — a coherent set of linked flow nodes,
of which a board may hold several. What the code called a *workflow* in the board sense is called
a **board** — `Workflow` becomes `BoardContent`, `WorkflowDto` (whole board, both sides)
`BoardDetailDto`, `WorkflowView` `BoardCanvas`, `readWorkflow`/`writeWorkflow`/`mergeWorkflow`
their `BoardContent` selves, and the runner's `workflowBoard` `boardContent` with the
`flowNode`-prefixed settings, success, spot, criterion and statuses it always held. What it called
a *workflow run* is called a **chain run** — a run executes one chain of one board, and a board
may have several playing at once: `WorkflowRunner` becomes `ChainRunner`, `workflowRun` `chainRun`
throughout, the six endpoints move from `/hybridflow-runner/workflow-runs/*` to
`/hybridflow-runner/chain-runs/*`, the socket frame `workflowRun` becomes `chainRun` with the
`hello` list `chainRuns`, and the run logs move from `<state>/workflow-runs/` to
`<state>/chain-runs/`. Protocol version 19.

**Why:** the word was doing three jobs, and the third one is about to arrive. A board already *holds*
workflows in the coming sense — the chains drawn as arrows between cards — while the code called the
board itself a workflow *and* an execution of it a workflow run. Every sentence about any of the three
was ambiguous, and the coming notion would have had no word left to take. The entries above that say
`workflow` where they meant board or run — the 2026-09-15 one above all — are read through this one.

**What keeps its name:** the word itself, where it was already right — *agentic workflow management*,
the workflow/agent UI, the promo pages, the workflows a board shows as lines — and where it is
somebody else's: the `workflow` background item of the Muse and Codex protocols, with the roster,
the drains and the tests that speak of it. The frozen history keeps it too: the store schema, the
file-store migrations and their seed fixtures, the past entries of this log.

**How the deploy carries it.** The socket breaks cleanly — a tab on another `hello.protocolVersion`
is told to reload, which is the mechanism — but the HTTP surface does not: the six old paths stay
mounted on the same handlers, because nothing on that surface tells a script or a bookmarked curl
to move. The run logs move themselves: the first open renames `workflow-runs/` to `chain-runs/`
where the new directory is not there yet. The tool bar tab id moves with the rename
(`hybridflow-ui-chain-runs`); a bar holding the old one falls back to its first tab, as it already
did for a tab nothing registers.
