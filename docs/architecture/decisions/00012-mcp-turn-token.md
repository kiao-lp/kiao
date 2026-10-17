---
id: "00012"
title: "a turn's MCP servers authenticate with a token minted for that turn"
status: accepted
date: 2026-08-23
tags: ["agents", "mcp", "auth", "worker"]
components: ["worker", "kiao-mcp"]
paths: []
symbols: ["KIAO_MCP_TURN_TOKEN", "--mcp-config", "--strict-mcp-config", "KIAO_WORKER_MCP_PATH", "StaticTokenProvider", "finishTurn"]
triggers: ["turn MCP", "tool auth", "401 from a turn", "strict config", "bundle size", "./utils subpath"]
supersedes: []
superseded_by: []
---

# 00012 — a turn's MCP servers authenticate with a token minted for that turn

**Decision:** worker hands each Claude turn the `kiao-mcp` servers through
`--mcp-config <generated file> --strict-mcp-config`, pointed at itself on `http://127.0.0.1:<port>`.
It mints a random per-turn token bound to the identity the WebSocket caller authenticated as, puts
it in the spawned CLI's environment as `KIAO_MCP_TURN_TOKEN`, accepts it in the auth middleware
ahead of the JWT check, and revokes it in `finishTurn`. The generated file names the credential as
`${KIAO_MCP_TURN_TOKEN}`, which the CLI expands from its own environment — so the token is never
written to disk and never appears in `ps`. Off unless `KIAO_WORKER_MCP_PATH` names a staged
bundle: on for the VPS and the Docker image, off for `kiao`.

**Why at all:** the CLI reaches the store's *files* already — it is spawned with `--add-dir` on the
store root. What it has no way to know is what a unit is: the chain of articles and exercise sets,
the `.mlunit.json` shape, the index, publishing. That is written once, in TypeScript, in
`reference/npm/kiao-mcp`, and the way to give it to a turn is to let the turn call the same servers
a developer machine calls. Only the base URL and the credential differ, so `WorkerClient`,
`UnitApi`, `CvApi` and all 47 tools are the same code in both deployments — the whole server-side
addition to the package is one `StaticTokenProvider`.

**Why not the two obvious credentials.** A Keycloak service account would have put a long-lived,
full-write secret in the env file and attributed every write to the service rather than to whoever
asked for it. Passing the caller's own access token through costs five lines and expires mid-turn —
Keycloak's are minutes long, a turn is not — with no refresh token on that side to recover with. A
token this service mints has neither problem, and it is the honest description of what is
happening: a process this service spawned, acting for the user who asked, for as long as that turn
lasts.

**Why the second flag matters.** `--mcp-config` without `--strict-mcp-config` *adds* to whatever
the CLI's own configuration declares, and on a server deployment `<HOME>/.claude.json` is state a
turn can itself write. The pair is what makes the servers a turn gets exactly the ones the
deployment configured. It is also why the feature is opt-in rather than always-on: under
`kiao` the CLI and the home directory are the developer's own, and strict mode there would
silently remove servers they registered themselves.

**Why `units,cv` and not `files`.** `kiao-files` is available and off by default. `Read`, `Write`,
`Edit` and `Bash` already reach the store, so it would mostly shadow the CLI's own tools. It stays
configurable because it is not purely redundant — `files_rename` runs the link-fix pass that a `mv`
does not.

**A cost worth recording:** the bundle is 27 MB, nearly all of it `@modelcontextprotocol/sdk` and
the HTTP/OAuth transports it carries but stdio never uses. Getting there also required a change in
`kiao-worker`: it now publishes a `./utils` subpath, because its barrel re-exports the React context
and hooks, which made `react`/`react-dom` a hard runtime requirement of anything importing it —
7 MB of React in a bundle that renders nothing. `kiao-mcp` takes its one runtime import,
`quoteSearchTerm`, from that subpath. `bin/stage-kiao-mcp.sh` starts every entrypoint before
declaring success, so a barrel import added later fails the build rather than the VPS.

## Refactor notes

TODO: confirm how `KIAO_WORKER_MCP_PATH` enablement interacts with the toolbox ledger seed (00028), which says `KIAO_WORKER_MCP_SERVERS` seeds the ledger and then stops being the authority.
