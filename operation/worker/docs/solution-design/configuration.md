---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Configuration

← [worker](/operation/worker/README.md) · assumes the index.

Configuration is read from environment variables at startup.

In `prod`, every human JWT must carry `files_user`, granting the owner full API access from
every application. Keep issuer and JWKS validation enabled; assign the role explicitly to the
owner, never through default roles or public registration. There is no client-specific role
or root scope. Per-turn callback credentials and the hybridflow-store service bearer keep
their technical authentication. See the
[access decision](/docs/solution-design/decisions/00068-owner-access-from-every-application.md).

Selected resolved settings are logged at startup without credentials, and a handful of
values are validated before the service binds its port — a bad value aborts start-up with an
ERROR line naming every problem rather than failing later at request time.

**The harness settings are namespaced**, and the split is what a setting *is*:
`KIAO_WORKER_HYBRIDFLOW_RUNNER_<SETTING>` for what the deployment says about every harness — the bypass
gate, the turn cap, one policy and one turn registry whichever CLI runs — and
`KIAO_WORKER_HYBRIDFLOW_RUNNER_<NAME>_<SETTING>` for harness-specific settings: `CLAUDE`, `CODEX`,
`MUSE`, `OPENCODE` and `PI`. `internal/hybridflow-runner/config/config.go` defines the supported
compatibility aliases under `KIAO_WORKER_HARNESS_*`, `KIAO_WORKER_CLAUDE_*` and
`KIAO_WORKER_CODEX_*`. The namespaced name wins, then the `HARNESS_*` alias, then the flat alias
where defined. An explicitly empty namespaced value also wins; the setting's reader decides
whether that means a default, an omitted flag or a disabled feature.

| Env var | Default | Notes |
| --- | --- | --- |
| `SERVER_PORT` | `8080` | Listen port (prod: `18080`). |
| `KIAO_WORKER_ROOT_PATH` | `/tmp` | Document store root; any directory is supported. **Validated:** must be an existing directory. |
| `KIAO_WORKER_STATE_PATH` | `<root>/.kiao-config` | [Operational state](./state.md), with per-store isolation by default; may be placed outside the root. **Validated:** must be absolute — the default is made absolute from the root, so only a hand-configured relative value is refused, rather than writing state at the working directory. |
| `KIAO_KEYCLOAK_ISSUER_URI` | *(blank)* | JWT issuer validated on every request — the deployment's own Keycloak realm. **Validated:** required (non-empty) in `prod` auth mode. |
| `KIAO_KEYCLOAK_JWK_SET_URI` | *(blank)* | JWKS used to verify RS256 signatures. **Validated:** required (non-empty) in `prod` auth mode. |
| `KIAO_GIT_USER_NAME` / `KIAO_GIT_USER_EMAIL` | `Kiao Dashboard` / `dashboard@localhost` | Identity for Source-Control commits. |
| `KIAO_WORKER_MIGRATIONS_PATH` | *(blank)* | One named base source directory with `source.json`; alternative to `MIGRATIONS_SOURCES`. Empty path and manifest disable discovery. Scripts honour the store's `.kiao-files` declaration. |
| `KIAO_WORKER_MIGRATIONS_SOURCES` | *(blank)* | Assembly manifest with `base` and ordered `additional` directories. Paths are relative to the manifest; source IDs remain stable across installations. Configuring both settings is an error. |
| `KIAO_WORKER_MIGRATIONS_ENABLED` | `true` | Master switch. |
| `KIAO_WORKER_MIGRATIONS_FAIL_ON_ERROR` | `true` | Abort on script/runtime/checksum failure. False warns and stops all further migrations but permits serving. Configuration, ledger and persistence errors always abort. |
| `KIAO_WORKER_MIGRATIONS_TIMEOUT_SECONDS` | `600` | Positive per-script timeout, shared by every source. |
| `KIAO_WORKER_MIGRATIONS_NODE_BINARY` | `node` | `node` executable used to run migration scripts (resolved on PATH). |
| `KIAO_WORKER_LINK_FIX_EXTENSIONS` | `.md,.txt,.html,.htm,.csv,.json,.yaml,.yml,.adoc,.rst` | Comma-separated text extensions the link-fixer scans and rewrites after a rename/delete. |
| `KIAO_WORKER_LINK_FIX_WORKERS` | `16` | Concurrent link-fix workers; values below 1 use one worker. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_CREDENTIALS_PATH` | `~/.claude/.credentials.json` | OAuth credentials file read for the `/hybridflow-runner/usage` rate-limit probe. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_LOGIN_ENABLED` | `true` | Exposes `/hybridflow-runner/auth/login/*`, which signs this host's `claude` CLI in from a browser. `false` removes the login endpoints; authentication status remains readable. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_MUSE_LOGIN_ENABLED` | `true` | Exposes the Muse sign-in — the device flow and the API key — from the usage panel. `false` removes the login endpoints. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CODEX_LOGIN_ENABLED` | `true` | Exposes Codex device-code and API-key login in Usage. `false` removes the login endpoints; authentication status remains readable. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_BYPASS_ENABLED` | `true` | Whether a turn may run in `bypassPermissions`, the mode that spawns the CLI with `--dangerously-skip-permissions` and asks nothing. On by default, which is what a machine whose owner is its only user wants. `false` withdraws the mode everywhere it can be chosen and makes `manual` the default for a request that names none; the two manual modes are untouched. The kiao image ships with it off — see `docs/user-manual/deep-dive/kiao-docker.md`. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_MAX_TURNS` | `4` | Concurrent harness turns across every conversation. **Validated:** at least 1. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_SETTING_SOURCES` | `user` | Passed as `--setting-sources`; an explicit empty value omits the flag. The default keeps a `.claude/settings.json` arriving in the store through `git pull` from installing hooks that run as the service user — `--print` loads project settings with no prompt of any kind. **Validated:** every element is `user`, `project` or `local`. |
| `KIAO_WORKER_ACTIONS_PATH` | *(blank)* | The file-action manifest; blank disables the feature. **Validated:** must parse and declare well-formed actions. |
| `KIAO_WORKER_SHUTDOWN_COMMAND` | *(blank)* | What turns the machine off when a board's **Shutdown card** is played. Split on spaces and run without a shell. Blank — every deployment but `kiao`, which sets `systemctl poweroff` — is a service that cannot, and the card is then played and marked `error`. |
| `KIAO_WORKER_MCP_PATH` | *(blank)* | The staged `kiao-mcp` bundle whose servers a turn may be handed. Blank means those rows of the configuration panel read *unavailable*. **Validated:** must be absolute, and every entrypoint it names must be readable. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_ENABLED` | `true` | The deployment's veto on Claude. It is a veto and not an offer: a harness is in the tab when this is on, its CLI is on the `PATH`, and the configuration panel has not switched its row off — all three asked per request, which is what makes installing a CLI take effect on the next page rather than at the next restart. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CODEX_ENABLED` | `true` | The same for Codex, and separate from Claude's because "disable Codex" and "disable Claude" are two decisions. Codex publishes `bypassPermissions` alone, so a deployment with `HYBRIDFLOW_RUNNER_BYPASS_ENABLED=false` offers it no runnable mode at all. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_MUSE_ENABLED` | `true` | The same for Muse. Also accepts `KIAO_WORKER_HARNESS_MUSE_ENABLED`. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_OPENCODE_ENABLED` | `true` | The same for OpenCode; no aliases. OpenCode publishes `bypassPermissions` alone, so a deployment with `HYBRIDFLOW_RUNNER_BYPASS_ENABLED=false` offers it no runnable mode. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_PI_ENABLED` | `true` | Deployment gate for Pi; no aliases. Installations, profiles and secrets are described in [Pi](/operation/worker/PROTOCOL/pi.md). |
| `KIAO_WORKER_SKILLS_PATH` | *(blank)* | Optional absolute directory containing `skills.json` and additional skill trees supplied by the assembly. Empty selects embedded skills alone. The worker composes both catalogues before plugin filtering and synchronization at startup and equipment refresh. Conflicts and invalid or unreadable sources suspend the pass, keeping installed copies intact; the worker continues. See [the catalogue contract](/reference/kiao-skills/README.md). |
| `KIAO_WORKER_HARNESS_*_SKILLS_PATH` | *(unread)* | Obsolete destination settings: a set variable produces a warning and has no effect. Skills are installed under the store's `.agents/skills` and `.claude/skills`. `KIAO_WORKER_SKILLS_PATH` configures an additional source. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CODEX_IGNORE_USER_CONFIG` | `false` | Passes `--ignore-user-config` to a Codex turn this service hands MCP servers to — the counterpart of the Claude driver's `--strict-mcp-config`, and a far blunter instrument: it withdraws not the user's MCP servers but the user's configuration entire, model provider and catalogue included. A host whose `codex` is configured by hand stops working the moment it is on, which is why it is off by default and a deployment that owns its `CODEX_HOME` turns it on deliberately. |
| `KIAO_WORKER_MCP_SERVERS` | `files,hybridflow` | Seeds the toolbox ledger; the panel controls turn equipment once that ledger exists. Supported names are `files`, `hybridflow`, `units` and `cv`. The latter two require assembly-provided bundle overlays; naming one without its script fails startup. **Validated:** each name must be known and its bundle script readable when `MCP_PATH` is set. |
| `KIAO_WORKER_TOOLBOX_PATH` | *(blank)* | The one directory the configuration panel may install into, and the whole of what it may write outside the state directory. Blank — the default — makes the panel read-only: a deployment that has not said where software may be installed has not agreed to software being installed. Deliberately not defaulted to a path under `$HOME`. **Validated:** must be absolute, and must not overlap the state directory, which is swept at startup. |
| `KIAO_WORKER_TOOLBOX_CATALOG_PATH` | *(blank)* | Absolute directory of `*.json` catalogue additions, merged in filename order after the embedded catalogue. Empty uses only the embedded catalogue. Invalid catalogues fail startup. |
| `KIAO_WORKER_TOOLBOX_BUNDLED_PATH` | *(blank)* | Absolute read-only runtime tree shipped with kiao; Pi profile resolution checks it after the writable toolbox prefix. |
| `KIAO_WORKER_HYBRIDFLOW_URL` | *(blank)* | hybridflow-store URL. Empty disables board operations; conversations remain available. |
| `KIAO_WORKER_HYBRIDFLOW_TOKEN` | *(blank)* | Service bearer for hybridflow-store, allowing runs to outlive the initiating user token. |
| `KIAO_WORKER_RUNNER_ID` | *(blank)* | Runner identity. A non-empty value overrides `runner.json`; otherwise that state document is read and adopted on save. |
| `KIAO_WORKER_LOG_FILE` | *(blank)* | Additional log destination, initialized before configuration is loaded. |
| `KIAO_WORKER_AUTH_MODE` | `prod` | `debug` permits all and decodes tokens without validation, for local verification only. When unset or empty, `SPRING_PROFILES_ACTIVE` containing `debug` (case-insensitive) selects debug mode as a compatibility fallback. An explicit auth mode wins. **Validated:** must be `prod` or `debug`. |

The [file contract](../../PROTOCOL/files.md) owns the compile-time multipart upload cap.
The [migration contract](/migrations/README.md) owns source identities, ledgers, execution order,
locking, the active baseline and next version, `worker migrate-files`, and
[`.kiao-files` scope](/migrations/README.md#kiao-files).
The [cutover](/migrations/cutover-2026-10-20.md) specifies supported stores and older upgrades.
