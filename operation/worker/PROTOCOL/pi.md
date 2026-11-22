---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Pi execution profiles

Pi is one harness, `pi`, driven through JSONL RPC. The profile chooses an exact installation,
provider connections and an allowlist of provider/model pairs. Profiles belong to the executing
worker; managed agents only retain `profileId`. A missing runner profile is an explicit refusal.
Existing engines and documents may omit every field below.

## Profiles and secrets

All endpoints require `files_user`, like the other runner endpoints.

| Method and route | Contract |
| --- | --- |
| `GET /hybridflow-runner/profiles` | Profile document, `availableInstallations`, configuration status and secret-reference presence; never secret values. |
| `PUT /hybridflow-runner/profiles` | Replace `{version:1, defaultPiProfileId?, installations:[], profiles:[]}`. The worker increments profile revisions and invalidates model caches. |
| `PUT /hybridflow-runner/profile-secrets/{id}` | Store `{value}` privately; returns only its `private:id` reference and configured state. |
| `GET /hybridflow-runner/profile-secrets` | List `{secrets:[{id,reference,preview,usedBy:[{profileId,profileName,provider}]}]}`. Values stay masked. |
| `GET /hybridflow-runner/profile-secrets/{id}` | Explicitly reveal `{reference,value}` to the owner. Responses are never cached. |
| `DELETE /hybridflow-runner/profile-secrets/{id}` | Delete a private key; existing references remain and report missing authentication. Returns 204. |
| `POST /hybridflow-runner/profiles/{id}/diagnostic` | Verify configured model IDs against the installed Pi catalogue and list reasoning levels. Empty lists and missing keys are actionable errors. No model request or provider discovery. |
| `POST /hybridflow-runner/profiles/{id}/connection` | Explicit bounded API test for `{model:"provider/model"}`. This makes a model request. |

The API test disables tools and reasoning and caps output at 256 tokens without changing the
stored profile. Success returns `{status:"ready"}`. A failed diagnostic returns HTTP 400 with
`{status,message,details?}`: `configuration_error`, `api_error`, `runtime_error` or `timeout`.
Runtime failures include the exit status and a bounded, credential-redacted tail of Pi's error
output. An API error received before process exit remains an API error. Success requires an
assistant reply; process exit or an empty settlement never proves API access.

A profile has stable `id`, `name`, server-managed `revision`, `installationId`, `connections`,
`defaultModel`, optional `defaultEffort`, `tools`, `mcpServers`, `extensions` and `promptTemplates`.
Each connection has a unique `provider` name, `api`, `baseUrl`, `secretRef` and `models`.
Supported APIs are `openai-completions`, `openai-responses`, `anthropic-messages` and
`google-generative-ai`. A connection name may alias a compatible provider. A model ID may contain
slashes: the first slash in `provider/model` separates the connection.

A model entry carries `id`, optional `name`, `reasoning`, `input`, `contextWindow`, `maxTokens`,
`cost`, `compat` and `thinkingLevelMap`. The map names the provider effort sent for each Pi thinking
level, and `null` removes that level. Pi offers `xhigh` and `max` only for the levels the map declares,
so a model without one keeps the levels up to `high`. Keys outside Pi's seven levels and values other
than a string or `null` are refused.

`secretRef` accepts `env:NAME` or `private:id`. Empty means an unauthenticated endpoint.
Private keys live under `<StatePath>/harness-secrets/`, with owner-only permissions. OAuth is not
exposed: durable concurrent refresh has not been qualified. Profiles live in
`<StatePath>/harness-profiles.json`, outside content access, board exports and transcripts.
Key writes and deletes invalidate model caches. Key listing and reveal responses use
`Cache-Control: no-store`; only the explicit reveal endpoint returns a key's full value.

External `installations` explicitly declare `{id, engine:"pi", version:"1.5.2", path, protocol:"pi-rpc-1.5",
external:true}`. `path` is an absolute executable or a declared command resolved on PATH; its
version is checked. Toolbox installations are reported separately in `availableInstallations`.
The toolbox ships Pi 1.5.2, using the official npm install lock
with SHA256 verification and Node.js 22.19+, 23.8+ or 24+ with Zstandard support. The launcher
prefers the toolbox's Node and checks the actual runtime's version and decompression capability
before loading Pi. Cross-target image staging uses host npm without qualifying the host as a Pi
runtime; the Docker build runs the same Node check inside Alpine and checks each preinstalled Pi.
Removing a referenced version identifies the
profiles and active conversations that use it and refuses removal; profile/session data is retained.

Profiles keep exact installation references across upgrades. Install Pi 1.5.2 and select `pi-1.5.2`
in profiles using an older managed installation. Redeclare external installations with the supported
version and protocol after updating their executable. Profile settings and native sessions are retained.

Resource entries have `path`, `version`, and `sha256`. They identify explicit local files; a turn
checks the digest and never fetches packages. Prompt templates and extensions must support RPC;
terminal-only custom layouts are outside the browser contract. KIAO's bundled bridge provides
permission hooks and the `ask_user` tool. Native, MCP and nested Codemode tools share those hooks.

## Options, conversations and turns

`GET /hybridflow-runner/options` adds `profiles`, `defaultProfileId` and `capabilities` on Pi's harness
entry. Each profile reports `status`, `message`, `secretStates`, and `models`; each model reports
`provider`, `modelId`, `efforts` and `capabilities`. Status values distinguish `installation_missing`,
`incomplete`, `auth_required`, `model_unavailable` and `ready`. Capabilities are `steer`, `followUp`,
`compact`, `branch`, `forkAtMessage` and `imageInput`. Catalogue reads are cached by the profile
configuration, revision and installation; writes invalidate them. No quota window is invented.

The published agent specifies the Pi profile and model. Omitted values use the configured Pi
defaults. The conversation records the resolved profile and model at creation. Select a different
agent publication on a fork to change them. Before launch, the worker resolves the configuration
and records `execution: {profileId, profileRevision, version, provider, model, effort}` on
prompts, replies and traces. Keys, composed authentication files and environment values are excluded.
Images reach the driver as native image blocks only after model capability validation; other files
keep their host-path reading convention.

Pi starts one process per turn. Its harness directory is disposable and private to that process:
settings, model connections, authenticated toolbox MCP selection, instructions, synchronized store
skills and pinned resources are composed there, selected through `PI_CODING_AGENT_DIR`.
Host auth and project `.pi` configuration cannot override this selection.
Native sessions and entry mappings live in the conversation's private
`pi/` directory; they complement the common transcript. A new process resumes these after restart.

Whole forks use native `clone`; a message fork maps the retained assistant entry to the next native
user entry before `fork`. Branching happens on a private copy before model changes, preserving the
source byte for byte. Another profile receives a distinct session with the common transcript as
context. Each successor node owns its own conversation. `/compact` invokes RPC `compact` directly.

## Live commands and settlement

Socket protocol **20** adds:

| Direction | Frame | Meaning |
| --- | --- | --- |
| Client | `{type:"follow_up", conversationId, text}` | Enqueue text after current work, through the optional driver port. |
| Client | `{type:"clear_queue", conversationId}` | Cancel pending messages, retaining their text and cancellation state. |
| Server | `{type:"queue", conversationId, turnId, messages}` | Whole roster of `{id,text,state}`; state is `pending`, `delivered` or `cancelled`. |

`sync.queue` and assistant transcript `queue` restore the roster on reconnect and after restart.
Pi's user-message event acknowledges delivery, including repeated identical messages in FIFO order.
`between` remains the existing steering command, mapped to Pi `steer`. Other drivers keep their
behavior; unsupported deferred operations are refused rather than silently queued.

Completed text/thinking blocks and tool calls/results are correlated once, including parallel and
nested tool IDs. Provisional deltas are not exposed by this port. Retries and compaction emit notices.
Questions use `question_request`/`question_answer`; permissions use their existing separate frames,
with Manual Live deadlines owned by the hub.

`agent_end` is not terminal: Pi may retry or process queued messages. Only `agent_settled`, followed
by process shutdown and descendant cleanup, produces the single terminal result. Stop clears the
queue, cancels open extension dialogs before aborting, and waits for cleanup before settlement. Process crashes produce a failure.
Session-total usage differences account for the current turn, including compaction and nested usage,
without adding individual reports again. Account quotas remain unavailable.
