---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-10-10
tags: ["harnesses", "opencode", "worker"]
triggers: ["OpenCode", "DeepSeek", "Mistral", "reasoning", "auto-reject", "release tarball", "musl", "stdin prompt", "opencode run", "--format json", "--session", "--fork", "--variant", "OPENCODE_CONFIG_CONTENT", "{env:VAR}", "opencode models", "opencode auth login", "bypassPermissions", "step_finish", "tool_use"]
supersedes: []
superseded_by: []
---

# 00049 — OpenCode is fourth harness with two supported models.

## Context and Problem Statement

OpenCode must fit the common conversation contract while exposing only supported CLI
capabilities. Run mode resumes and forks sessions but cannot handle interactive permission replies.

## Considered Options

* Integrate one OpenCode JSON process per turn through the common harness port.

Other considered options were not recorded.

## Decision Outcome

Chosen option: "Integrate one OpenCode JSON process per turn through the common harness port",
because its events and native sessions fit the existing frames without a wire change.

The open-source `opencode` CLI offers DeepSeek V4 Pro (`deepseek/deepseek-v4-pro`) and
Mistral Large 4 (`mistral/mistral-large-4`) first, followed by models from
`opencode models` for configured providers. Each turn runs `opencode run --format json`:
`text` becomes text, `reasoning` thinking, `tool_use` a call and outcome, and
`step_finish` tokens accumulate into the bill. `--session` resumes and `--fork`
branches the CLI session.

Only `bypassPermissions` is exposed: without `--auto`, permission requests are
auto-rejected. `Answer` and `Say` are refused; stdin carries the prompt through EOF.
Effort passes verbatim as `--variant` (`low`, `medium`, `high`, `max` for DeepSeek V4);
models without that variant ignore it.

`OPENCODE_CONFIG_CONTENT` supplies an `mcp` object overriding other configuration.
Ledger `${VAR}` references become `{env:VAR}`, keeping the turn credential in its
environment rather than files or process arguments visible through `ps`. Briefing precedes
the prompt in stdin because there is no per-turn system prompt. Without supplied servers,
the user's configuration is used unchanged.

### Consequences

* Bad, because OpenCode exposes past-turn cost but no account quota, so quota is unavailable.
  Keys come from host `opencode auth login` or environment; no sign-in panel is provided.
* Bad, because installation relies on TLS without a published checksum. The toolbox uses
  GitHub release tarballs, musl on Alpine, matching the publisher's unverified installer.
