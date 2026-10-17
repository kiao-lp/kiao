---
id: "00047"
title: "Muse is the third agent, driven over `muse serve`"
status: accepted
date: 2026-09-12
tags: ["agents", "muse"]
components: ["worker"]
paths: ["operation/worker/internal/agents"]
symbols: ["muse serve", "MSP", "session/start", "turn/start", "approval/decide", "userInput/answer", "turn/steer", "turn/cancel", "model/list", "settings.json", "allowAll", "onRequest"]
triggers: ["Muse", "Spark", "sandbox", "approval", "staged config", "skills symlink", "quota unavailable", "untrusted workspace"]
supersedes: []
superseded_by: []
---

# 00047 — Muse is the third agent, driven over `muse serve`

**Decision:** a conversation may run on **Muse** — the `muse` CLI and its Spark models — with the
same comfort as a Claude one: all three permission modes, questions put to the user, speaking into
a running turn, and forks the engine remembers. The driver holds one `muse serve` session host per
turn and speaks MSP — JSON-RPC over stdio — to it: `session/start`, `resume` or `fork` to open the
conversation's session, `turn/start` to run the prompt, `approval/decide` and `userInput/answer` to
settle what the turn parks on, `turn/steer` for a between, `turn/cancel` for a stop. The models the
prompt offers are the catalogue a host answers to `model/list`, read live and cached, so the
offered models are the ones the account can actually run.

**Why a host per turn, and why `serve` rather than `exec`.** `muse exec` is a finished answer: it
runs a prompt and prints what came out, with no channel to ask on — the Codex shape, which is why
Codex publishes bypass alone. `serve` is the shape with the channels: approvals and questions
arrive as notifications and are decided over the same pipe. And one host per turn is the lifecycle
the agent half already has: sessions outlive the host that ran them on the log on disk, so a later
turn resumes by id and a `serve` that only ever runs one turn is one process per turn, like `claude`
and `codex exec` before it.

**The sandbox stays off, in every mode.** Muse's sandbox would be a second gate beside the
approvals — a write the user allowed refused by a policy nobody was shown — where the other agents
have exactly one: what the user decided. Bypass is `allowAll` and both manual modes are
`onRequest`, which asks about every tool call.

**The MCP servers travel as a staged `settings.json`.** `serve` takes no MCP flag; what it reads is
`mcp_servers` in its configuration file. A turn handed servers is therefore pointed at a configuration
of its own — the ledger's servers with the turn's token written in (measured: that CLI expands no
`${VAR}` and inherits no environment into its servers, like Codex) — beside symlinks to the user's
skills and login, and **no trust file**: without one the workspace is untrusted, so no project
skill, rule or MCP declaration loads from the store. That absence is the counterpart of the Claude
driver's `--setting-sources user`. A turn handed no servers runs with the user's configuration
untouched.

**Two panels stay dark.** MSP reports per-session token usage and no account quota to draw a strip
from, and `muse login` is a device flow in a terminal with no step the service could drive from a
panel — so a Muse conversation reads its quota as unavailable and is signed in where its host is,
the same honest shape Codex has. The wire changed nowhere: the third agent answered in the frames
the first two already shared, which is what agent-neutrality was for.

## Refactor notes

Quota later answered via harvest (00057); only the sign-in panel stays dark.
