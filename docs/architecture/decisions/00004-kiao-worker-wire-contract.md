---
id: "00004"
title: "`kiao-worker` is the single home for the wire contract"
status: accepted
date: 2026-07-16
tags: ["contracts", "typescript", "wire"]
components: ["kiao-worker", "dashboard", "kiao-mcp"]
paths: ["reference/npm/kiao-worker"]
symbols: ["types.ts", "agent-types.ts", "cv-model.ts", "FileDto", "PROTOCOL.md"]
triggers: ["wire change", "new DTO", "field rename", "contract drift", "exhaustive switch"]
supersedes: []
superseded_by: []
---

# 00004 — `kiao-worker` is the single home for the wire contract

**Decision:** the TypeScript types that describe the worker wire (`FileDto` and friends in
`types.ts`, the agent protocol in `agent-types.ts`, the CV model in `cv-model.ts`) live only in
`reference/npm/kiao-worker`; `dashboard` and the MCP servers consume them, never a local copy, and
the Go `types.go`/`agents/claude_ws.go` are documented as the mirror in `PROTOCOL.md`. **Why:** one
contract with two implementations (Go server, TS client) drifts silently unless there is a single
declared home; centralizing it turns a drift into a compile error on the consumer side (e.g.
`useClaudeSocket` switches exhaustively over `ClaudeServerMessage`). Wire compatibility is sacred —
field names are the wire and are never renamed.

## Refactor notes

Entry text still says `claude-types.ts` / `ClaudeServerMessage`; read through the agent rename (00036).
