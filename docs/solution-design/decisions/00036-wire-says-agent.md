---
id: "00036"
title: "the wire says *agent* where it used to say *Claude*"
status: accepted
date: 2026-09-03
tags: ["agents", "wire", "rename"]
components: ["worker", "dashboard", "kiao-worker"]
paths: ["exchange/dashboard/src/plugins/agent"]
symbols: ["agent-types.ts", "AGENT_PROTOCOL_VERSION", "/agents/*", "/ws/agent", "KIAO_WORKER_AGENT_*", "useAgentOptions", "V006__workflow-task-agent.js", "playable()"]
triggers: ["claude path", "agent name", "capability registry", "workflowSettings.agent", "old env var", "alias drift"]
supersedes: []
superseded_by: ["00050"]
---

# 00036 — the wire says *agent* where it used to say *Claude*

**Decision:** the contract, the routes and the UI are agent-neutral in name as well as in fact.
`reference/npm/kiao-worker/src/claude-types.ts` is `agent-types.ts` and every `Claude…` type in it is
an `Agent…` one; `hello` carries `agents`, the names this deployment offers with the default first;
`AGENT_PROTOCOL_VERSION` is 11. The REST surface answers under `/agents/*` **and** under the
`/claude/*` it has always had — one handler, two names — while the socket moved to `/ws/agent` and
keeps `/ws/claude` answering beside it. `exchange/dashboard/src/plugins/claude` is `plugins/agent`,
the plugin id with it, and the agent is picked when a conversation is created and shown on the prompt
bar. `KIAO_WORKER_CLAUDE_*` became `KIAO_WORKER_AGENT_*` for what the deployment says
about every agent and `KIAO_WORKER_AGENT_<NAME>_*` for what is one agent's own, with every old
name still read.

**Why the two surfaces answered the rename differently.** The socket announces a version and a
mismatch is a reload — that is the whole mechanism, and it has been used deliberately before — so it
can move. Nothing on the HTTP surface announces anything, so a client left on the old paths has no
way of being *told* to move: a script, a bookmarked curl, a `kiao-mcp` bundle staged by an older
build. Aliasing costs one function (`aliased`, `agents/routes.go`) that mounts each route twice, and
the pair cannot drift because there is one list.

**The capability registry keeps every publisher of a name**, in assembly order, rather than the last
one merged in (`PluginList-ctx`). `useCapability` returns the list. What several publishers mean is
the kit's to say name by name, and the answer is one of two: **the first** for anything that must
happen exactly once — showing a chat, playing a task, the one run there is — and **all of them,
gathered** for anything that is a list by nature, which is `agent.options`. That last one is why the
change is more than a rename: the lists a task's settings are chosen from are now **per agent**, and
`useAgentOptions()` answers with the agents and a lookup rather than three flat arrays.

**The board's fifth setting, and the one breaking change with a cost.** `workflowSettings` gains
`agent`, and `playable()` requires it. It had a default until now — the deployment's — and taking
that away is deliberate: the other four settings are written in *that agent's* vocabulary and no one
else's. `opus` is a model on Claude and no model at all on Codex; the three permission modes a Claude
turn offers are one on a Codex turn. A card naming a model without naming the engine would play on
whichever agent the deployment happened to offer first, which for a board written for Claude on a
host that has since installed Codex is a turn nobody asked for. Every board written before the field
is rewritten once by `migrations/V006__workflow-task-agent.js`, which writes `"agent": "claude"` onto
every AI card that names a model and no agent — so a board keeps its Play buttons instead of losing
them to a field nobody could have written. Changing the agent in the editor clears the model, the
effort and the permission mode with it; the folder stays, being a place in the store and nobody's
vocabulary.

**What a store keeps.** `claudeCodeEnabled` is `agentEnabled` and the plugin id `claude` is `agent`,
both read under their old names when a store's `dashboard.json` still says them: a config document
outlives the build that wrote it, and a rename in this repository is no reason to drop a choice the
user recorded.

## Refactor notes

`agent` field now names a managed agent id (00050); cards naming the engine directly still play.
