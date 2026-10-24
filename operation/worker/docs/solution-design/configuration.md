# Configuration

← [worker](/operation/worker/README.md) · assumes the index.

Configuration is read from environment variables at startup.

The resolved configuration is logged in full at startup (it holds no secrets), and a handful of
values are validated before the service binds its port — a bad value aborts start-up with an
ERROR line naming every problem rather than failing later at request time.

**The agent settings are namespaced**, and the split is what a setting *is*:
`KIAO_WORKER_HYBRIDFLOW_RUNNER_<SETTING>` for what the deployment says about every agent — the bypass
gate, the turn cap, one policy and one turn registry whichever CLI runs — and
`KIAO_WORKER_HYBRIDFLOW_RUNNER_<NAME>_<SETTING>` for one agent's own, `CLAUDE`, `CODEX`, `MUSE` and `OPENCODE` being the four
names. **Every old `KIAO_WORKER_AGENT_*`, `KIAO_WORKER_CLAUDE_*` and
`KIAO_WORKER_CODEX_*` name is still read**, and that is not a deprecation notice: a deployment
that never changes its env file gets exactly what it always did. The namespaced name wins where several
are set — including when it is set to the empty string, which is a deliberate act on the settings whose
empty value means something.

| Env var | Default | Notes |
| --- | --- | --- |
| `SERVER_PORT` | `8080` | Listen port (prod: `18080`). |
| `KIAO_WORKER_ROOT_PATH` | `/tmp` | Data root (a git work tree). **Validated:** must be an existing directory. |
| `KIAO_WORKER_STATE_PATH` | `<root>/.kiao-config` | Where the service keeps its **own** state and no content: the migration ledger (`files-migrations.json` + `files-migrations.lock`), the conversation registry, the process lock, and the Dashboard config documents. Deriving from the root gives each store its own set; set it only to keep state *out* of the root (a store that gets wiped and re-cloned). Inside the root it is hidden from the file API and given a `.gitignore` of `*`. **Validated:** must be absolute — the default is made absolute from the root, so only a hand-configured relative value is refused, rather than writing state at the working directory. |
| `KIAO_KEYCLOAK_ISSUER_URI` | *(blank)* | JWT issuer validated on every request — the deployment's own Keycloak realm. **Validated:** required (non-empty) in `prod` auth mode. |
| `KIAO_KEYCLOAK_JWK_SET_URI` | *(blank)* | JWKS used to verify RS256 signatures. **Validated:** required (non-empty) in `prod` auth mode. |
| `KIAO_WORKER_READER_ROOTS` | `units` | Comma-separated root-relative prefixes the read-only `files_reader` role is confined to; a request from such a caller for a path outside every one of them is 403. `files_user` is never scoped by it. An explicitly empty value leaves no reader roots, which closes the read-only role rather than opening the store. |
| `KIAO_GIT_USER_NAME` / `KIAO_GIT_USER_EMAIL` | `Kiao Dashboard` / `dashboard@localhost` | Identity for Source-Control commits. |
| `KIAO_WORKER_MIGRATIONS_PATH` | *(blank)* | One named base source directory with `source.json`; alternative to `MIGRATIONS_SOURCES`. Empty path and manifest disable discovery. Scripts honour the store's `.kiao-files` declaration. |
| `KIAO_WORKER_MIGRATIONS_SOURCES` | *(blank)* | Assembly manifest with `base` and ordered `additional` directories. Paths are relative to the manifest; source IDs remain stable across installations. Configuring both settings is an error. |
| `KIAO_WORKER_MIGRATIONS_ENABLED` | `true` | Master switch. |
| `KIAO_WORKER_MIGRATIONS_FAIL_ON_ERROR` | `true` | Abort on script/runtime/checksum failure. False warns and stops all further migrations but permits serving. Configuration, ledger and persistence errors always abort. |
| `KIAO_WORKER_MIGRATIONS_TIMEOUT_SECONDS` | `600` | Positive per-script timeout, shared by every source. |
| `KIAO_WORKER_MIGRATIONS_NODE_BINARY` | `node` | `node` executable used to run migration scripts (resolved on PATH). |
| `KIAO_WORKER_LINK_FIX_EXTENSIONS` | `.md,.txt,.html,.htm,.csv,.json,.yaml,.yml,.adoc,.rst` | Comma-separated text extensions the link-fixer scans and rewrites after a rename/delete. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_CREDENTIALS_PATH` | `~/.claude/.credentials.json` | OAuth credentials file read for the `/hybridflow-runner/usage` rate-limit probe. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_LOGIN_ENABLED` | `true` | Exposes `/hybridflow-runner/auth/login/*`, which signs this host's `claude` CLI in from a browser. `false` removes the login endpoints; authentication status remains readable. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_MUSE_LOGIN_ENABLED` | `true` | Exposes the Muse sign-in — the device flow and the API key — from the usage panel. `false` removes the login endpoints. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CODEX_LOGIN_ENABLED` | `true` | Exposes Codex device-code and API-key login in Usage. `false` removes the login endpoints; authentication status remains readable. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_BYPASS_ENABLED` | `true` | Whether a turn may run in `bypassPermissions`, the mode that spawns the CLI with `--dangerously-skip-permissions` and asks nothing. On by default, which is what a machine whose owner is its only user wants. `false` withdraws the mode everywhere it can be chosen and makes `manual` the default for a request that names none; the two manual modes are untouched. The kiao image ships with it off — see `docs/user-manual/deep-dive/kiao-docker.md`. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_MAX_TURNS` | `4` | Turns (one `claude` process each) allowed to run at once across every conversation. **Validated:** at least 1 — a zero cap refuses every turn as "too many turns", which is indistinguishable from a service that is merely busy. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_SETTING_SOURCES` | `user` | Passed as `--setting-sources`; an explicit empty value omits the flag. The default keeps a `.claude/settings.json` arriving in the store through `git pull` from installing hooks that run as the service user — `--print` loads project settings with no prompt of any kind. **Validated:** every element is `user`, `project` or `local`. |
| `KIAO_WORKER_ACTIONS_PATH` | *(blank)* | The file-action manifest; blank disables the feature. **Validated:** must parse and declare well-formed actions. |
| `KIAO_WORKER_SHUTDOWN_COMMAND` | *(blank)* | What turns the machine off when a board's **Shutdown card** is played. Split on spaces and run without a shell. Blank — every deployment but `kiao`, which sets `systemctl poweroff` — is a service that cannot, and the card is then played and marked `error`. |
| `KIAO_WORKER_MCP_PATH` | *(blank)* | The staged `kiao-mcp` bundle whose servers a turn may be handed. Blank means those rows of the configuration panel read *unavailable*. **Validated:** must be absolute, and every entrypoint it names must be readable. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_ENABLED` | `true` | The deployment's veto on Claude. It is a veto and not an offer: an agent is in the tab when this is on, its CLI is on the `PATH`, and the configuration panel has not switched its row off — all three asked per request, which is what makes installing a CLI take effect on the next page rather than at the next restart. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CODEX_ENABLED` | `true` | The same for Codex, and separate from Claude's because "disable Codex" and "disable Claude" are two decisions. Codex publishes `bypassPermissions` alone, so a deployment with `HYBRIDFLOW_RUNNER_BYPASS_ENABLED=false` offers it no runnable mode at all. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_MUSE_ENABLED` | `true` | The same for Muse. Its one legacy spelling is `..._AGENT_MUSE_ENABLED`: there was no third agent before there was a namespace, so it never had a flat name. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_OPENCODE_ENABLED` | `true` | The same for OpenCode. It has no legacy spelling: there was no fourth agent before there was a namespace either. OpenCode publishes `bypassPermissions` alone, so a deployment with `HYBRIDFLOW_RUNNER_BYPASS_ENABLED=false` offers it no runnable mode at all. |
| `KIAO_WORKER_SKILLS_PATH` | *(blank)* | Optional absolute directory containing `skills.json` and additional skill trees supplied by the assembly. Empty selects embedded skills alone. The worker composes both catalogues before plugin filtering and synchronization at startup and equipment refresh. Conflicts and invalid or unreadable sources suspend the pass, keeping installed copies intact; the worker continues. See [the catalogue contract](/reference/kiao-skills/README.md). |
| `KIAO_WORKER_AGENT_*_SKILLS_PATH` | *(unread)* | Previous installation destinations in agent homes. Skills now live in the store (`.agents/skills`, `.claude/skills`) without configurable destinations. A variable still set is reported and not read. These are unrelated to the additional **source** above. |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CODEX_IGNORE_USER_CONFIG` | `false` | Passes `--ignore-user-config` to a Codex turn this service hands MCP servers to — the counterpart of the Claude driver's `--strict-mcp-config`, and a far blunter instrument: it withdraws not the user's MCP servers but the user's configuration entire, model provider and catalogue included. A host whose `codex` is configured by hand stops working the moment it is on, which is why it is off by default and a deployment that owns its `CODEX_HOME` turns it on deliberately. |
| `KIAO_WORKER_MCP_SERVERS` | `files,hybridflow` | Which of them (`files`, `hybridflow`, `units`, `cv`). It **seeds** the toolbox ledger on a store that has never had one and stops being the authority the moment it exists — from then on it is the panel that says which servers a turn gets. `units` and `cv` are personal servers, overlaid into the bundle only by deployments that ship them; naming one without the overlay fails the start. **Validated:** every name is one of the four. |
| `KIAO_WORKER_TOOLBOX_PATH` | *(blank)* | The one directory the configuration panel may install into, and the whole of what it may write outside the state directory. Blank — the default — makes the panel read-only: a deployment that has not said where software may be installed has not agreed to software being installed. Deliberately not defaulted to a path under `$HOME`. **Validated:** must be absolute, and must not overlap the state directory, which is swept at startup. |
| `KIAO_WORKER_AUTH_MODE` | `prod` | `debug` permits all and decodes tokens without validating (dev only). Also enabled when `SPRING_PROFILES_ACTIVE` contains `debug`. **Validated:** must be `prod` or `debug`. |

The multipart upload cap is a compile-time constant (100 MB, matching the original Spring limit).

The migration ledger at `<state>/files-migrations.json` uses format 2 with independent source
versions/checksums. Base work precedes additions, under one lock and failure policy.
The 2026-10-20 base baseline reserves V001–V018; the next base migration is V019.
The [migration contract](../../../../migrations/README.md) covers authoring and `.kiao-files` boundaries;
the [cutover](../../../../migrations/cutover-2026-10-20.md) specifies supported stores and older upgrades.
`worker migrate-files` runs this pass under the normal state lock without starting services.
