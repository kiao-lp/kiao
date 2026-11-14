---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-07-16
tags: ["contracts", "typescript", "wire", "kiao-worker", "dashboard", "kiao-mcp"]
triggers: ["wire change", "new DTO", "field rename", "contract drift", "exhaustive switch", "types.ts", "harness-types.ts", "FileDto", "HarnessServerMessage", "PROTOCOL.md"]
supersedes: []
superseded_by: []
---

# 00002 — kiao-worker alone holds TypeScript wire contract types.

## Context and Problem Statement

The Go server and TypeScript clients implement one wire contract. Independently maintained
TypeScript definitions can drift silently.

## Considered Options

* Keep TypeScript wire types in `kiao-worker` and import them in consumers.
* Maintain local copies of wire types in consumers.

## Decision Outcome

Chosen option: "Keep TypeScript wire types in `kiao-worker` and import them in consumers",
because a shared definition turns incompatible consumer code into a compilation error.

`reference/kiao-worker` alone holds `FileDto` and related types in `types.ts`, and the
agent protocol in `harness-types.ts`. Dashboard and MCP servers import them.
`PROTOCOL.md` identifies Go's `types.go` / `agents/claude_ws.go` as the server mirror.
For example, `useAgentSocket` switches exhaustively over `HarnessServerMessage`.
Wire-field changes require coordinated server and consumer updates.
