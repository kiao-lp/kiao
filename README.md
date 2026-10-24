# KIAO — base distribution

Everything needed to develop, run and ship the base KIAO. Three names, three things —
two of them functional sets that cut across containers, not containers themselves:

- **DCMS** — *document and content management system* — is the file and content
  management feature: the file-oriented views of [dashboard](exchange/dashboard)
  together with the `files` service inside [worker](operation/worker) (the document
  store, git, search, config documents, file actions, media). Neither half is useful
  alone.
- **hybridflow** — *agentic workflow management* — is the workflow and agent feature:
  the boards and conversations UI of [dashboard](exchange/dashboard) (the
  `hybridflow-ui` and `agent` plugins) together with the `hybridflow-runner` inside
  [worker](operation/worker) (conversations, turns, the play loop) and the
  [hybridflow-store](operation/hybridflow-store) backend (boards, cards, agents,
  runners in PostgreSQL).
- **kiao** is the one deliverable containing both and more — the PlantUML renderer, the
  `kiao-mcp` servers, the skills, the toolbox: the `kiao` Docker image and the `kiao`
  executable.

## Contents

- [`exchange/dashboard`](exchange/dashboard/README.md) — the React/Vite CMS: file-oriented,
  plugin-based, one plugin per file type.
- [`operation/worker`](operation/worker/README.md) — the Go file store API over a plain
  filesystem + git, with the agent runner. Runs the [`migrations/`](migrations) at startup.
- [`operation/hybridflow-store`](operation/hybridflow-store/README.md) — the boards and the
  cards on them, in PostgreSQL. Go, one static binary.
- [`reference/`](reference) — shared NPM packages, built first: `kiao-style`,
  `kiao-worker`, `kiao-mcp`.
- [`reference/kiao-skills/`](reference/kiao-skills) — the agent skills shipped with kiao,
  embedded in the worker binary and installed into every store it opens.
- [`migrations/`](migrations) — versioned file-store migrations the worker runs at startup.
- [`e2e/`](e2e) — the Playwright end-to-end suite, on throwaway stacks it starts itself.
- [`bin/`](bin/README.md) — the shared build stage and the two end scripts (image, executable).
- [`config/local/`](config/local) — local ports and the PostgreSQL the boards develop against.
- [`docs/`](docs) — [the user manual](docs/user-manual/README.md),
  [running the image](docs/user-manual/deep-dive/kiao-docker.md),
  [running the executable](docs/user-manual/deep-dive/kiao-executable.md),
  [installing the dev environment](docs/developer-manual/InstallDevelopmentEnv.md),
  [the architecture](docs/architecture/README.md) and
  [the solution designs](docs/solution-design/README.md).

## Build and run

```bash
./bin/build-all.sh               # reference libs, Go binaries, kiao-mcp, Dashboard tree — once
./bin/build-kiao-image.sh        # the kiao Docker image, or
./bin/install-kiao-executable.sh # the kiao executable on this machine
./bin/local-start-kiao.sh        # kiao over a folder, for development
./bin/test-e2e.sh                # the end-to-end suite
```

Prerequisites: Go 1.24+, Node.js 20+, Docker. A JDK is only needed to regenerate the
subject taxonomy. See [`bin/README.md`](bin/README.md) for what the shared stage builds
and what each end script adds.

## See also

- The [architecture documents](docs/architecture/README.md).
- The [solution designs](docs/solution-design/README.md), including container-local designs and decision records.
- [AGENTS.md](AGENTS.md) — guidance for coding agents working in this tree.
