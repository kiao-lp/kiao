---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# AGENTS.md

Guidance for a coding agent working in this tree — the base KIAO distribution: DCMS (the
document management feature of Dashboard + the files service in worker) and hybridflow (the
workflow/agent UI + the hybridflow-runner in worker + hybridflow-store), with the reference
libraries, the file-store migrations, the e2e suite and the tooling that builds the Docker
image and the installed executable.
Guidance for the Claude Code harness lives in [CLAUDE.md](CLAUDE.md).

Links in this tree's entry files are relative, so they resolve whether the tree is opened alone
or as part of the monorepo.

## Project overview

Three names, three things. DCMS and hybridflow are functional sets that cut across
containers — usage names for a feature spanning several of them — not containers themselves:

- **DCMS** — *document and content management system* — is the document management
  feature: the file-oriented views of `exchange/dashboard` together with
  the `files` service inside `operation/worker` (document store, git, search, config
  documents, file actions, media). Neither half is useful alone.
- **hybridflow** — *agentic workflow management* — is the workflow and agent feature:
  the Hybridflow plugin in `exchange/dashboard` (boards, conversations and agents) together with the `hybridflow-runner` inside `operation/worker`
  (conversations, turns, the play loop) and the `operation/hybridflow-store` backend
  (boards, flow nodes, runners in PostgreSQL), plus `operation/agentic-resource-manager`
  (agent Git repositories, APM resolution and package delivery).
- **kiao** is the one deliverable containing both and more — the `kiao` Docker image and
  the `kiao` executable. Say it instead of "the image and the executable".

The [DCMS concept catalog](docs/architecture/data/dcms-concept-catalog.md) defines **document**
as an identifiable, persisted information artifact, created, received, assembled or manipulated.
This is the encompassing term for managed information in operational and technical prose.
**Content** is an identifiable, structured information unit intended for publication or
distribution. Product presentations can spell out the uses: document collections, source code
repositories or knowledge bases.

For Hybridflow terms, including agents, harnesses and board elements, consult the
[Hybridflow concept catalog](docs/architecture/data/hybridflow-concept-catalog.md).

Write document references that resolve from the DCMS root as **DCMS links**. Use
`dcmsLinkOf` and `storePathOf` from `kiao-worker/utils` to convert between DCMS links
and file API paths. The [DCMS concept catalog](docs/architecture/data/dcms-concept-catalog.md)
distinguishes those forms from document-relative Markdown links and Dashboard URLs.

The containers keep their own names: a change to the SPA is `feat(dashboard): …`, a change
to the Go file and turn backend is `feat(worker): …`, a change to the boards backend is
`feat(hybridflow-store): …`. `dcms` is the scope for what spans the DCMS halves (Dashboard
file views + the files service); `hybridflow` for what spans the hybridflow parts;
`kiao` for what spans DCMS and hybridflow — the deliverable as a whole.

## This tree never points outside itself

No path, no hostname, no personal name, no default that only makes sense on one person's machine:

- a secured Dashboard names its realm at build time (`VITE_OIDC_AUTHORITY`); the fallback is a
  loopback placeholder;
- a prod worker requires its issuer and JWKS URIs (`KIAO_KEYCLOAK_ISSUER_URI`,
  `KIAO_KEYCLOAK_JWK_SET_URI`) and refuses to start without them;
- example hosts are `example.com`;
- dropped-in plugin projects arrive as `VITE_PLUGIN_PATHS` from outside the tree; this tree
  carries the delivered lot and nothing else.

See the [solution design decision records](docs/solution-design/decisions/README.md).

## Build commands

**Default to tests scoped to the change**: select the affected Go package, Vitest file or
directory, or Playwright spec. Run a full suite only when the change spans that suite or
targeted results leave a concrete concern to investigate. Documentation-only changes need
a diff/rendering review, not a test suite.

### Prerequisites

- Go 1.27.3+ (worker, hybridflow-store, agentic-resource-manager, launcher)
- Node.js 20+ (reference packages, Dashboard, e2e)
- Git and Python 3.11+ for image staging and the local stack. `apm-cli==0.35.1` to resolve
  agent packages when running the resource manager outside the image.
- Docker (the `kiao` image, the local PostgreSQL)

### Reference libraries (built first)

```bash
./bin/build-reference.sh
```

Builds the NPM packages in dependency order: `kiao-style`, `kiao-worker`, then
`kiao-mcp`.

### The shared build stage (`bin/build-all.sh`)

The two kiao end scripts — `bin/build-kiao-image.sh`, `bin/install-kiao-executable.sh` —
**assume `./bin/build-all.sh` was run first**. It builds what they have in common exactly once:
the reference libraries, the Dashboard dependency tree, the linux/amd64 worker and
hybridflow-store and agentic-resource-manager binaries and the staged `kiao-mcp` bundle. The end scripts check for it
(`bin/require-build-all.sh`) and stop with a pointer back to it rather than rebuilding it.
The published checkout includes the pinned `mcp-kiao` sources. See the
[build scripts](bin/README.md#the-shared-build-stage) for the source layout and image seed.

The Dashboard *bundle* stays with each end script: its `VITE_*` values are baked in at build time
and differ per target. `bin/README.md` has the full table of what is shared and what is not.

### Backend services

```bash
# From a Go service directory
cd operation/worker
go build ./...
go test ./internal/files/  # affected package; replace files with the package changed
go test ./...             # full suite — only when justified by the scope
```

Use `go test ./internal/<pkg>/` for one package; add `...` after its trailing slash only
when its subpackages are also affected.

### Frontend (Dashboard — React/Vite)

```bash
cd exchange/dashboard && npm install && npm start
npm run build   # production build
npx vitest run src/plugins/code-edit/index.test.tsx  # replace with the affected test path
npm run test    # full Vitest suite — only when justified by the scope
```

Use `npx vitest run <path>` with the affected test file or directory.

### Running the stack

```bash
# Throwaway stack on temp data — the way to verify a change end-to-end.
# Dashboard, worker and agentic-resource-manager, no config and no Docker needed.
cd e2e && bash bin/start-env.sh

# kiao on a folder, on fixed local ports (config/local/.env-local).
./bin/local-start-kiao.sh

# kiao as an installed executable, on any folder — one instance per folder
# (./bin/install-kiao-executable.sh; docs/user-manual/deep-dive/kiao-executable.md).
kiao ~/some/project
```

See [verify](agentic-resources/skill-verify/SKILL.md) for ports and readiness checks.

### E2E tests (Playwright)

```bash
cd e2e
npm install
bin/run-tests.sh tests/dashboard/file-search.spec.ts  # affected spec (auto-starts the stacks)
E2E_SHARDS=1 bin/run-tests.sh tests/dashboard/file-search.spec.ts  # debug one spec with one worker
bin/run-tests.sh                              # full suite — only when justified by the scope
```

`npm test` and `./bin/test-e2e.sh` are the same script. **Run the suite through it and not through
`playwright test`**: it always terminates (a `globalTimeout` inside, a `timeout` outside), it
always reports (Playwright's output goes to `log/e2e-run.log`; what is printed is the counts and
the failures), and it reaps a previous interrupted run first (marked `KIAO_E2E=1`, so a
developer's own stack is never caught by mistake).

```bash
bin/run-tests.sh --detach   # start it; it survives the terminal, the session, the agent
bin/run-tests.sh --status   # the verdict, or how far it has got — instant, from anywhere, later
bin/run-tests.sh --wait     # block until the running one finishes
```

**One stack per Playwright worker.** Shard *n* on ports `48310+n` and `48332+n`; `tests/harness.ts`
hands each Playwright worker its own. A spec imports `test`, `expect` and `workerApi()` from there
rather than from `@playwright/test`, and never names a port.

## Architecture and solution design

**Read the [architecture preliminaries](docs/architecture/README.md) before designing anything.**
Architecture means solution-agnostic documentation and is centralized in `docs/architecture/`.
Solution-specific documentation, implementation reviews and implementation guidance are
**solution designs**: global designs spanning systems live in `docs/solution-design/`;
single-container designs live in that container's `docs/solution-design/` beside its code.
In Dashboard, a component's design lives in its `docs/solution-design/`, whether the
component is in `src/core/`, `src/kit/` or `src/plugins/`. Choose the primary owner of
the behavior; references to callers, dependencies and adapters belong with that design.
Shared conventions, application assembly and designs with several owners stay at the
Dashboard level. Dashboard decision records stay centralized in
`exchange/dashboard/docs/solution-design/decisions/`.
Reference every local design index from the
[central solution design index](docs/solution-design/README.md), and update the
owning index whenever a page is added or moved.

Decision records are centralized by container: one file per decision in the container's
`docs/solution-design/decisions/`; global records live in `docs/solution-design/decisions/`.
All are indexed by the shared
[decision index](docs/solution-design/decisions/README.md). It allocates IDs and
tracks supersession across global and container-local records.
Use [kiao-adr](agentic-resources/skill-kiao-adr/SKILL.md), the reference for the MADR core,
optional catalogue extensions and authoring conventions.
Running the image is `docs/user-manual/deep-dive/kiao-docker.md`; running the executable is
`docs/user-manual/deep-dive/kiao-executable.md`.

### Three-zone structure

```
reference/   — Shared libraries; built first, consumed by all other zones
operation/   — Backend services (Go)
exchange/    — The Dashboard single-page app
```

### Reference libraries

- **`reference/`** — NPM packages consumed via `file:` protocol; explicit build order enforced
  in `bin/build-reference.sh`:
  1. `kiao-style` (CSS design tokens)
  2. `kiao-worker`, then `kiao-mcp`

### Operation services

- **`worker`** — File storage API over a plain filesystem + git and the Hybridflow runner.
  **Go**, no database. Runs the file-store migrations in the tree-root `migrations/` at
  startup. `internal/app` assembles three service families over focused `internal/core/*` packages: `internal/files`
  (the document store — the DCMS backend half), `internal/hybridflow-runner`
  (conversations, harness dispatch, quota, permissions, skills, attachments and the play loop)
  and `internal/toolbox` (what is installed on the machine, and which
  MCP servers a turn is handed — shared by both). See the code map in
  `operation/worker/README.md`.
- **`agentic-resource-manager`** — Agent Git/APM repositories, publication and resource cache — **Go**,
  hexagonal; [service contract](operation/agentic-resource-manager/README.md).
- **`hybridflow-store`** — The boards and the flow nodes on them, in PostgreSQL — **Go**,
  hexagonal, one static binary.

### Any folder can hold documents

Any folder can serve as the **DCMS root**. A **`.kiao-files`** declaration
excludes paths from automatic passes; it may sit in *any* directory and covers that
directory and everything below. It bounds the three passes that walk a store on their own:
file-store migrations (`[migration]`), link updates after a rename or a delete (`[refactor]`), and
search plus the scope a delete reports (`[search]`).

This matters most for **file-store migrations** (`migrations/`), the pass that rewrites files
nobody asked it to touch, automatically, before the service serves a request. Select on document
shape rather than on reachability, never substring-replace across the tree, honour `.kiao-files`,
and **when it is not certain that every file a migration would touch matches the intended document format,
ask for confirmation with the list of paths rather than guessing**. Read `migrations/README.md`
before writing one.

**An applied migration is frozen.** Each named source has its own version/checksum ledger. Fix what
a past migration did in a *new* one. The only exception is a coordinated history retirement with a
checked baseline, complete script replacement, retained knowledge and verified delivery — see
[`migrations/README.md`](migrations/README.md) and the
[2026-10-20 cutover](migrations/cutover-2026-10-20.md). Never reset a ledger while retired scripts
remain discoverable.

### Skills

An agent publication supplies the skills selected in its APM manifest. Edit them in their
Git/APM source repositories. [Agentic resource delivery](docs/solution-design/agentic-resources.md)

Read these sources from the corresponding local checkouts when working on this repository.
The [resource catalogue](agentic-resources.json) records their Git locations and pins.

- Launch and test a temporary KIAO stack. [verify](agentic-resources/skill-verify/SKILL.md)
- Design and check hexagonal services. [hexarch](agentic-resources/skill-hexarch/SKILL.md)
- Write or extend a Dashboard plugin. [dashboard-plugin](agentic-resources/skill-dashboard-plugin/SKILL.md)
- Add a worker file action. [file-actions](agentic-resources/skill-file-actions/SKILL.md)

## One person per installation

Each kiao installation serves **one person's own files**, and the account the service runs under is
theirs. There is no second operator to be kept out: do not add per-user isolation, and do not add
a confirmation whose only justification is that a command could touch something outside the store.
`filesystem.ResolvePath` stays strict for a different reason: a path leaving the store is a bug in the
caller.

All applications, including listening clients, use the owner's Keycloak account with
`files_user` and the same full access. The operations an application presents do not narrow
the account's rights. Assign this role explicitly to the owner, never through default roles
or public registration. Server authentication stays enabled: a valid human JWT without
`files_user` is refused. Agent and service credentials retain their technical authentication.
See the [access decision](docs/solution-design/decisions/00067-owner-access-from-every-application.md).
Path bounds, state-directory protection and file-operation
checks remain functional requirements. **What the machine reaches outward** — an ssh remote,
a `git push`, a deploy — deserves the same care as ever.

## Branching

Commit directly on the current branch — including `main`. Never create a branch on your own
initiative. If a branch is wanted, it will be asked for explicitly.

## Commit style

Follow Conventional Commits: `type(scope): description`

- **Types**: `feat`, `fix`, `refactor`, `docs`, `chore`, `build`, `e2e`
- **Scope**: kebab-case component name — `dashboard`, `worker`, `markdown-edit`, etc.
  Multiple scopes: `feat(dashboard,worker): ...`, or `dcms` for a change that spans the DCMS
  halves, `hybridflow` for one that spans the hybridflow parts, `kiao` for one that spans
  DCMS and hybridflow
- **Description**: short, lowercase, no trailing period, no capital letter
- **No `Co-Authored-By` trailer** — never add it

Keep the whole message short and focused on what is delivered — the subject line alone
for most commits.

## Configuration

Local ports live in `config/local/.env-local` (range 482xx–483xx). Keep local ports below 49152 —
the Windows ephemeral pool starts there, and WSL2 intermittently steals anything above it.

The end-to-end tests use a throwaway stack that takes its ports and data from `e2e/`.
