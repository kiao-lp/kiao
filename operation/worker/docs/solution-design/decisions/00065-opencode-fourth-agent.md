---
id: "00065"
title: "OpenCode is the fourth agent, with DeepSeek Pro and Mistral Large 4"
status: accepted
date: 2026-10-10
tags: ["agents", "opencode"]
components: ["worker"]
paths: ["operation/worker/internal/agents"]
symbols: ["opencode run", "--format json", "--session", "--fork", "--variant", "OPENCODE_CONFIG_CONTENT", "{env:VAR}", "opencode models", "opencode auth login", "bypassPermissions", "step_finish", "tool_use"]
triggers: ["OpenCode", "DeepSeek", "Mistral", "reasoning", "auto-reject", "release tarball", "musl", "stdin prompt"]
supersedes: []
superseded_by: []
---

# 00065 — OpenCode is the fourth agent, with DeepSeek Pro and Mistral Large 4

**Decision:** a conversation may run on **OpenCode** — the open-source `opencode` CLI — with
DeepSeek V4 Pro (`deepseek/deepseek-v4-pro`) and Mistral Large 4 (`mistral/mistral-large-4`)
as the two supported models. The driver holds one `opencode run --format json` process per
turn and reads its run events: `text` is text, `reasoning` is thinking, `tool_use` is a
tool call with its outcome on it, and the `step_finish` tokens fold into the turn's one
bill. Sessions resume with `--session` and fork with `--fork`, so a fork of an OpenCode
conversation is one OpenCode remembers. The models the prompt offers are the curated two
first, then whatever `opencode models` reports for the providers the host configured.

**The Codex shape, one channel further.** `opencode run` never asks either — without
`--auto` a permission request is auto-rejected — so OpenCode publishes `bypassPermissions`
alone, refuses `Answer` and `Say`, and reads its prompt from stdin to end-of-file, for the
Codex reasons. What it answers beyond the Codex set is the fork. The effort travels as
`--variant` verbatim — `low`, `medium`, `high`, `max` on DeepSeek V4 — and a model carrying
no such variant ignores it rather than refusing the turn, which is what makes one fixed
list safe for whatever the host runs.

**The MCP servers travel in the environment.** `OPENCODE_CONFIG_CONTENT` carries the
`mcp` object the CLI merges over every other configuration source, and the ledger's
`${VAR}` becomes the `{env:VAR}` the CLI expands from the turn's own environment — the
Claude arrangement, in OpenCode's spelling, so the turn's credential is never written to
a file and never appears in `ps`. The briefing travels in the input text ahead of the
prompt, the CLI having no per-turn system prompt. A turn handed no servers sets nothing
and runs with the user's own configuration untouched.

**Two panels stay dark, and the install is TLS alone.** OpenCode reports what past turns
cost and no quota to draw a strip from, and provider keys are the host's — `opencode auth
login` or the environment — so the quota reads as unavailable and there is no sign-in to
drive, the same honest shape Codex has. The toolbox installs the release tarball from the
project's GitHub releases, musl on Alpine, with no checksum to verify against — the
publisher offers none, and its own installer takes the same download unverified. The wire
changed nowhere: the fourth agent answered in the frames the first three already shared,
which is what agent-neutrality was for.
