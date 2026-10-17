# AGENTS.md

Guidance for a coding agent working in this tree — the base KIAO distribution: DCMS (the
file/content feature of Dashboard + the files service in worker) and hybridflow (the
workflow/agent UI + the hybridflow-runner in worker + hybridflow-store), with the reference
libraries, the file-store migrations, the e2e suite and the tooling that builds the Docker
image and the installed executable.
Agent-specific additions live beside it — [CLAUDE.md](CLAUDE.md) for Claude Code.

Links in this tree's entry files are relative, so they resolve whether the tree is opened alone
or as part of the monorepo.

## Project overview

Three names, three things. DCMS and hybridflow are functional sets that cut across
containers — usage names for a feature spanning several of them — not containers themselves:

- **DCMS** — *document and content management system* — is the file and content
  management feature: the file-oriented views of `exchange/dashboard` together with
  the `files` service inside `operation/worker` (document store, git, search, config
  documents, file actions, media). Neither half is useful alone.
- **hybridflow** — *agentic workflow management* — is the workflow and agent feature:
  the boards and conversations UI of `exchange/dashboard` (the `hybridflow-ui` and
  `agent` plugins) together with the `hybridflow-runner` inside `operation/worker`
  (conversations, turns, the play loop) and the `operation/hybridflow-store` backend
  (boards, cards, agents, runners in PostgreSQL).
- **kiao** is the one deliverable containing both and more — the `kiao` Docker image and
  the `kiao` executable. Say it instead of "the image and the executable".

**A link is a path with a leading slash.** Every reference a document holds — a sommaire's
`members`, a unit's `contents[].path`, a flow node's `settings.folder`, the `unit::` and
`template::` schemes, a markdown destination into the store — is written from the store root and
opens with `/`. In markdown, a path written *without* the slash is a document-relative link, read
against the document that holds it. Convert between the two forms with `storeLinkOf` /
`storePathOf` (`reference/npm/kiao-worker/src/utils.ts`), never by hand.

The containers keep their own names: a change to the SPA is `feat(dashboard): …`, a change
to the Go file/agent backend is `feat(worker): …`, a change to the boards backend is
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

See the [architecture decision records](docs/architecture/decisions/README.md).

## Build commands

**Default to tests scoped to the change**: select the affected Go package, Vitest file or
directory, or Playwright spec. Run a full suite only when the change spans that suite or
targeted results leave a concrete concern to investigate. Documentation-only changes need
a diff/rendering review, not a test suite.

### Prerequisites

- Go 1.27.2+ (worker, hybridflow-store, launcher)
- Node.js 20+ (reference packages, Dashboard, e2e)
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
hybridflow-store binaries and the staged `kiao-mcp` bundle. The end scripts check for it
(`bin/require-build-all.sh`) and stop with a pointer back to it rather than rebuilding it.

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
# Dashboard + worker alone, no config and no Docker needed.
cd e2e && bash bin/start-env.sh

# kiao on a folder, on fixed local ports (config/local/.env-local).
./bin/local-start-kiao.sh

# kiao as an installed executable, on any folder — one instance per folder
# (./bin/install-kiao-executable.sh; docs/user-manual/deep-dive/kiao-executable.md).
kiao ~/some/project
```

See `.agents/skills/verify/SKILL.md` for ports, ready checks and gotchas.

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

## Architecture

[`docs/architecture`](docs/architecture/README.md) is the one place the architecture is
written down, and its README is the index — **read it before designing anything, and add to it
when you write a new document there.** Decisions about kiao — either half, the boards,
the deliverable — go in `docs/architecture/decisions/` as one file per decision, indexed from its `README.md`; running the image is `docs/user-manual/deep-dive/kiao-docker.md`,
running the executable is `docs/user-manual/deep-dive/kiao-executable.md`.

### Three-zone structure

```
reference/   — Shared libraries; built first, consumed by all other zones
operation/   — Backend services (Go)
exchange/    — The Dashboard single-page app
```

### Reference libraries

- **`reference/npm/`** — NPM packages consumed via `file:` protocol; explicit build order enforced
  in `bin/build-reference.sh`:
  1. `kiao-style` (CSS design tokens)
  2. `kiao-worker`, then `kiao-mcp`
- **`reference/kiao-skills/`** — the agent skills for the formats the store holds: the DCMS
  formats and the hybridflow boards. They ship *with* kiao: embedded in the worker binary
  and installed into the store being edited at every start.
  **To change a shipped skill, edit `reference/kiao-skills/<name>/SKILL.md` — nothing else.**
  Each is the agent half of a Dashboard plugin and names it (`pluginOf` in `skills.go`).

### Operation services

- **`worker`** — File storage API over a plain filesystem + git, plus the agent engine —
  **Go**, no database. Runs the content-file migrations in the tree-root `migrations/` at
  startup. Four libraries and one program: `internal/core` (the socle), `internal/files`
  (the document store — the DCMS backend half), `internal/hybridflow-runner`
  (conversations, turns, quota, permissions, skills, attachments, the play loop — the
  hybridflow engine) and `internal/toolbox` (what is installed on the machine, and which
  MCP servers a turn is handed — shared by both). See the code map in
  `operation/worker/README.md`.
- **`hybridflow-store`** — The boards and the flow nodes on them, in PostgreSQL — **Go**,
  hexagonal, one static binary.

### The store is not necessarily a document store

DCMS serves **any folder** — a directory is the whole contract. A folder says what in it is not
content in a **`.kiao-files`** declaration, which may sit in *any* directory and covers that
directory and everything below. It bounds the three passes that walk a store on their own:
file-store migrations (`[migration]`), link updates after a rename or a delete (`[refactor]`), and
search plus the scope a delete reports (`[search]`).

This matters most for **file-store migrations** (`migrations/`), the pass that rewrites files
nobody asked it to touch, automatically, before the service serves a request. Select on document
shape rather than on reachability, never substring-replace across the tree, honour `.kiao-files`,
and **when it is not certain that every file a migration would touch is genuinely KIAO content,
ask for confirmation with the list of paths rather than guessing**. Read `migrations/README.md`
before writing one.

**An applied migration is frozen.** The runner compares the checksum of every script at or below the
ledger's version and refuses to start on a mismatch. Fix what a past migration did in a *new* one.

### Skills

- **`reference/kiao-skills/`** — the formats the store holds. They ship *with* kiao (see above).
- **`.agents/skills/`** — skills for developing *this tree* (`verify`, `hexarch`,
  `markdown-anchors`, `dashboard-plugin`, `file-actions`). Not shipped.

## One person per installation

Each kiao installation serves **one person's own files**, and the account the service runs under is
theirs. There is no second operator to be kept out: do not add per-user isolation, and do not add
a confirmation whose only justification is that a command could touch something outside the store.
`core.ResolvePath` stays strict for a different reason: a path leaving the store is a bug in the
caller.

Two things the premise does *not* dissolve. **The reader is not that person** — `files_reader` and
its `KIAO_WORKER_READER_ROOTS` allowlist stay a real boundary. And **what the machine reaches
outward** — an ssh remote, a `git push`, a deploy — deserves the same care as ever.

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

There is no `config/dev/`: the throwaway stack the e2e harness builds replaced it, and it
takes its ports (595xx) and its data from `e2e/` alone.
