# Scripts

Scripts are intended to be executed from the root directory of the project (./bin/ + script name).

## Prefixes (target activity)

- `local-`: for local execution. Usefull both for development process and local usage.

- `build-`: general building scripts (including reference libraries).

## Go toolchain

`bin/install-go-toolchain.sh` installs Go 1.27.3 under `/usr/local/go` and puts its `bin` first on
`PATH` for new shells, clearing any inherited `GOROOT`. Rerunning it repairs the shell
configuration even when that Go version is already installed. It verifies the installed Go
before reporting success.

The Go builds, executable installer, local start and e2e stack use `bin/find-go.sh` to select
`/usr/local/go/bin/go` first, so an older Go on `PATH` cannot override it. No shell reload is
needed. When that installation is absent, the lookup falls back to `PATH`, then
`~/go-sdk/go/bin/go` and `~/sdk/go/bin/go`.

These scripts also clear `GOROOT`, so the selected executable finds its own SDK even when
the shell still points at a removed installation. They use `GOTOOLCHAIN=local` to keep Go
from switching to another toolchain.

Run the toolchain regression checks with `node --test bin/go-toolchain.test.mjs`. They use
the real Go executable and temporary installation/profile paths; no root access is needed.

## The shared build stage

`bin/build-all.sh` builds, **once**, everything the two kiao end scripts have in common:

| | `build-kiao-image.sh` | `install-kiao-executable.sh` |
|---|---|---|
| reference libraries | ✔ | ✔ |
| Dashboard dependency tree | ✔ | ✔ |
| worker, linux/amd64 | ✔ | — (native to this machine) |
| hybridflow-store, linux/amd64 | ✔ | — (native to this machine) |
| staged `kiao-mcp` bundle | ✔ | ✔ |

Run it first; the two then *assume* it and build only what is theirs. They check for what they
consume through `bin/require-build-all.sh` and stop with a pointer back to `build-all.sh` rather
than rebuilding it, so running two of them in a row never pays for the same work twice.

```bash
./bin/build-all.sh                   # once
./bin/build-kiao-image.sh            # then either of these, in any order
./bin/install-kiao-executable.sh
```

The **Dashboard bundle** is deliberately not shared. Its `VITE_*` values are baked in at build time
and differ per target — an identity provider or none, a service worker or none, which plugin
projects, which public URLs — so no single bundle can serve both. Only the dependency tree,
the expensive half, is shared; each end script runs `npm run build` with its own environment.

A caller assembling its own copy drops its plugin projects in as `VITE_PLUGIN_PATHS`, which the
installed executable passes through to the bundle; the image carries the delivered lot and nothing
else.

For additional agent skills, `KIAO_EXTRA_SKILLS` supplies a directory with `skills.json` and its
skill resource trees to the executable installer. It replaces `<install>/skills` at every install;
without it, the base stages an explicit empty catalogue. The launcher sets
`KIAO_WORKER_SKILLS_PATH` to this installed source unless explicitly overridden. See the
[skill catalogue contract](/reference/kiao-skills/README.md).

For additional file migration sources, `KIAO_MIGRATIONS_ASSEMBLY` supplies a `sources.json` to the
executable installer. `stage-file-migrations.js` stages the base and additions with stable IDs,
relative paths and shared/local helper dependencies, excluding tests/examples, and replaces stale
scripts. The launcher enables the installed assembly only with `--migrations`; the image stages
only the base assembly and keeps its explicit opt-in. See the [migration contract](../migrations/README.md).

`require-build-all.sh` checks **presence, not freshness** — nothing can tell a binary built this
morning from one built last month. So a change to `reference/`, to `operation/worker` or to
`reference/kiao-mcp` needs `build-all.sh` rerun before the end script that ships it, or the
old artefact goes out. Rerunning is cheap where it matters: npm and Go both skip what has
not changed. A change confined to `exchange/dashboard` needs nothing — each end script builds the
bundle itself.

## Postfixes (function)

- `-start-kiao.sh`: start kiao locally — the worker, Dashboard and the boards — over a store root
  taken from `KIAO_WORKER_ROOT_PATH` or asked for.

- `-test-e2e.sh`: runs the end-to-end tests — a thin call to `e2e/bin/run-tests.sh`, which is
  where the suite's own arguments, its budget and its summary are documented. It reaps a previous
  interrupted run before starting, and always ends with a report rather than being left running.

- `-build-all.sh`: the shared build stage above — run it before either of the two end scripts.

- `-require-build-all.sh`: what those two call to check that it was; not run by hand.

- `-build-kiao-image.sh`: builds the single-container kiao image (Dashboard SPA +
  worker + hybridflow-store + PostgreSQL + PlantUML server) used to run the e2e suite
  on Windows with Docker, and to run KIAO there, with no server behind it. It ships neither a
  development toolchain nor an agent CLI: a JDK, a `claude`, a `codex` and anything else of
  that kind is installed into a container from the configuration panel and kept on a volume, so
  the image stays what it is. `--preinstall claude-cli` bakes one in anyway. See
  docs/user-manual/deep-dive/kiao-docker.md.

- `-install-kiao-executable.sh`: builds KIAO and installs it as a `kiao` executable on this
  machine — no Docker. `kiao <folder>` then serves that folder on the next free ports and
  opens a browser on it, one instance per folder. See docs/user-manual/deep-dive/kiao-executable.md.

- `-migrate-to-worker.sh`: rewrites this machine's `~/.config/kiao/config.env` after the
  files-service -> worker rename (`KIAO_FILES_SERVICE_*` keys become `KIAO_WORKER_*`), and
  reports a still-installed or still-running old binary. Called by the installer and the local
  start script, so it runs wherever the machine is touched; idempotent, and runnable by hand.
