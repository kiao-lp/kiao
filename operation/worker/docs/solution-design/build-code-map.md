# Build, run and code map

← [worker](../../README.md)

## Build and checks

Requires Go 1.27.3+. The module and its entry point remain at the worker root.

```bash
./build.sh                 # static linux/amd64 worker

go build ./...
go vet ./...
go test ./...              # all worker packages
```

For a local change, select the owning package and its affected consumers, for example
`go test ./internal/files/search/ ./internal/files/content/ ./internal/files/http/`.
A package move affecting the whole service warrants the complete worker suite.

The [verification procedure](/.agents/skills/verify/SKILL.md) describes the throwaway
Dashboard + worker stack. Run browser tests through
[e2e/bin/run-tests.sh](/e2e/bin/run-tests.sh), selecting the affected specs.
The live Muse handshake test also needs a compatible installed Muse host and filesystem.

## Entry point and composition

`main.go` calls `app.Run`. [app](../../internal/app) owns process commands, startup,
configuration validation, state adoption, the process lock, the root HTTP server and shutdown.
Its [server](../../internal/app/server.go) owns `readerRoutes` and `/healthz`.

The `files`, `hybridflow-runner` and `toolbox` roots expose small `Start`, `Config` and
`Service` façades. Their subpackages own the implementation. `core` is a namespace of shared
packages, not a package that imports all the service's responsibilities.

## Shared packages

All paths in this and the following tables are relative to `internal/`.

| Package | Owns |
| --- | --- |
| `core/access` | JWT authentication, reader scope, identities and per-turn callback tokens. |
| `core/filesystem` | Bounded storage paths, filesystem operations, atomic writes, state directories and locks. |
| `core/http` | Route declarations, middleware, response writers and HTTP error classification. |
| `core/errors` | Transport-independent caller-error markers and client-visible messages. |
| `core/config` | Shared deployment settings and environment readers. |
| `core/logging` | Structured logging, sinks and request correlation. |
| `core/process` | External commands and Linux descendant supervision. |
| `core/equipment` | MCP server declarations and agent installation records exchanged between services. |
| `core/ids` | Shared identifier generation. |

## Document store

| Package | Owns |
| --- | --- |
| `files/content` | Browsing, mutations, companions, staging, ZIP files and deduplication. |
| `files/search` | Query parsing, document extractors, index generation and reindexing. |
| `files/refactor` | Link updates after moves and deletions, including batch reports. |
| `files/scope` | `.kiao-files` parsing, inherited exclusions and bounded walks. |
| `files/migrations` | Script execution, checksums, locks and named source ledgers. |
| `files/git` | Git operations and their result models. |
| `files/actions` | Manifest validation, applicability and provider calls. |
| `files/media` | ffmpeg jobs, codecs, progress and segment output. |
| `files/configuration` | Settings, migration source declarations, configuration document names and delivered defaults. |
| `files/http` | REST handlers, route registration and service assembly. |

`content.FileService` uses `search.Searcher`; search has no dependency on file mutations.
The configuration package holds migration source metadata without executing scripts.
Import-gate JSON and PDF themes stay beside their synchronization code, under
`files/configuration/importgate` and `files/configuration/pdfthemes`.

## Hybridflow runner

| Package | Owns |
| --- | --- |
| `hybridflow-runner/agents` | Driver contracts, capabilities, agent selection and shared event/profile models. |
| `agents/{claude,codex,muse,opencode,pi}` | Each engine's protocol, execution, options, credentials and quota handling. |
| `agents/login` | The parked device-login process shared by Codex and Muse. |
| `agents/faults` | Turn refusals, failure classification and quota reset interpretation. |
| `agents/prompt` | Shared prompt instructions and commands. |
| `agents/protocol` | Shared protocol value conversion, text bounds and timestamp formatting. |
| `hybridflow-runner/config` | Runner settings, working folders, permission modes and bundled MCP declarations. |
| `hybridflow-runner/conversations` | Metadata, transcripts, forks, attachments and response models. |
| `conversations/trace` | Bounded, credential-scrubbed process traces and execution metadata. |
| `hybridflow-runner/turns` | `Engine`, live `Turn` state, reservations, permissions, questions and event application. |
| `turns/events` | Connection contracts, subscriptions and event routing under the engine's shared mutex. |
| `hybridflow-runner/playback` | Board execution, retries, schedules, gateways, shutdown and run logs. |
| `playback/state` | Run snapshots shared with execution and transport. |
| `hybridflow-runner/boards` | Board/agent/runner models, the upstream HTTP client, spool and heartbeats. |
| `hybridflow-runner/skills` | Catalogue composition, plugin filtering and managed skill synchronization. |
| `hybridflow-runner/assembly` | Concrete driver registration and engine construction. |
| `hybridflow-runner/http` | REST, WebSocket upgrade, framing, heartbeat and service assembly. |

The `agents/...`, `conversations/trace`, `turns/events` and `playback/state` shorthand rows
are relative to `hybridflow-runner/`.

`turns.Engine` receives an agent registry; it imports neither concrete drivers nor WebSocket.
`playback.TurnExecutor` is the execution port; `turns.RunObserver` carries run snapshots and
turn-stop notifications in the opposite direction. Assembly wires both.
The Pi bridge, qualification script and protocol fixtures live in `agents/pi/`.

## Toolbox

| Package | Owns |
| --- | --- |
| `toolbox/catalog` | The embedded `pub.json`, component definitions, recipes and dependency closure. |
| `toolbox/config` | Prefix paths, platform detection and installation environment. |
| `toolbox/inventory` | The persisted installation ledger and registration state. |
| `toolbox/install` | Installation lifecycle, jobs and channel recipes in separate source files. |
| `toolbox/mcp` | MCP resolution, initialization probes and runtime detection. |
| `toolbox/faults` | Toolbox caller-error sentinels. |
| `toolbox/http` | Toolbox routes and handlers. |
| `toolbox/cli` | Build-time preinstallation command parsing. |

Pi installation manifests and the Node compatibility check stay in `toolbox/install/pi/`.
The image and executable scripts stage the catalogue from `toolbox/catalog/pub.json`.

## Tests and dependencies

Unit tests sit beside their owning package. HTTP and cross-component scenarios live in each
family's `http` tests; their local fixtures construct the same concrete components used in production.
Codex and Pi test binaries dispatch the private supervisor mode before the Go test runner.

[packages_test.go](../../internal/app/packages_test.go) checks production imports: shared code
cannot depend on service families, service families cannot import one another, search cannot
import mutations, and turn execution cannot import HTTP, WebSocket or concrete drivers.
The compiler also checks that the package graph stays acyclic.

Adding an endpoint: [ADDING-AN-ENDPOINT.md](../../ADDING-AN-ENDPOINT.md).
The contracts remain in [PROTOCOL.md](../../PROTOCOL.md) and
[reference/kiao-worker](/reference/kiao-worker/).
