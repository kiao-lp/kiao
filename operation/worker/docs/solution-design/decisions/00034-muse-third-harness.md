---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-12
tags: ["harnesses", "muse", "worker"]
triggers: ["Muse", "Spark", "sandbox", "approval", "staged config", "skills symlink", "quota unavailable", "untrusted workspace", "muse serve", "MSP", "session/start", "turn/start", "approval/decide", "userInput/answer", "turn/steer", "turn/cancel", "model/list", "settings.json", "allowAll", "onRequest"]
supersedes: []
superseded_by: []
---

# 00034 — Muse is third harness via serve host per turn.

## Context and Problem Statement

Muse conversations need approvals, questions, steering and persistent forks through the
common harness interface. `muse exec` prints a finished answer without an interactive
decision channel.

## Considered Options

* Run one `muse serve` host per turn and communicate through MSP.
* Run prompts through `muse exec`.

## Decision Outcome

Chosen option: "Run one `muse serve` host per turn and communicate through MSP", because
MSP supplies interactive channels and on-disk sessions outlive the host.

The `muse` CLI and Spark models use JSON-RPC over stdio: `session/start`, `resume`
or `fork`; `turn/start`; `approval/decide` and `userInput/answer`;
`turn/steer` for a between; and `turn/cancel`. Live, cached `model/list` responses
supply models the account can run. One process per turn follows the Claude and Codex
lifecycle while later turns resume the stored session ID.

All three permission modes are supported. Bypass maps to `allowAll`; both manual modes
use `onRequest` for every tool call. Muse's sandbox stays off so it does not introduce
another gate after a user's approval.

For supplied MCP servers, worker stages `mcp_servers` in a private `settings.json`,
writing the turn token literally: measurements found neither `${VAR}` expansion nor
environment inheritance into servers. `serve` has no MCP flag. Symlinks expose the user's
skills and login, but no trust file is supplied, preventing project skills, rules or MCP
declarations from loading. This corresponds to Claude's `--setting-sources user`.
Without supplied servers, the user's configuration remains untouched.

## More Information

Quota follows the [harvesting contract](/docs/solution-design/decisions/00041-muse-quota-harvest.md).
`muse login` remains a host-terminal device flow without panel-driven sign-in.
The driver uses common harness frames without Muse-specific wire vocabulary.
