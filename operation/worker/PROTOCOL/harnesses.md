---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

<a id="workflow-agents-and-harnesses"></a>
# Agents and harnesses

← [worker wire protocol](/operation/worker/PROTOCOL.md) · assumes the index.

<a id="workflow-agents"></a>
## Agents

The [Hybridflow concept catalog](/docs/architecture/data/hybridflow-concept-catalog.md) defines
agents and harnesses. The worker proxies agentic-resource-manager's agent endpoints:

| Method | Path | Meaning |
|---|---|---|
| GET | `/hybridflow-runner/agents` | installed Git repositories |
| POST | `/hybridflow-runner/agents` | clone a Git `repository` URL or initialize a local agent |
| GET, PATCH | `/hybridflow-runner/agents/{id}` | read or edit the working tree |
| POST | `/hybridflow-runner/agents/{id}/publish` | compile, commit, tag and push the release; supports `If-Match` |
| GET | `/hybridflow-runner/agents/{id}/versions` | all publications, oldest first |
| GET | `/hybridflow-runner/agents/{id}/deletion` | local changes, remote status and deletion confirmation fingerprint |
| DELETE | `/hybridflow-runner/agents/{id}` | delete its clone with `?confirmation=…` from the deletion status |

An agent response includes its latest publication as `published`. A task conversation captures
that configuration at creation as `agentVersion`. A replay of a completed flow node selects the current
publication for its new conversation. Definitions and publications retain their harness and model
strings when runtime catalogues change.

## Harness endpoints

Every path in this section also accepts `/harnesses/…` and `/claude/…` as compatibility prefixes,
using the same handler and payload.

| Method | Path | Query / body | Response |
|---|---|---|---|---|
| GET | `/hybridflow-runner/usage` | `harness` (optional) | `HarnessUsageDto` for that harness's account; `404` for a harness with no account to report, `503` when it has one and could not be asked |
| GET | `/hybridflow-runner/options` | — | `{ models, efforts, permissionModes, defaultModel, defaultEffort, harnesses, defaultHarness }` — the choices the prompt UI offers, per harness, and the pair a new conversation starts with |
| GET | `/hybridflow-runner/harness-models` | — | Installed harnesses with model panels, as `[{ value, label }]` |
| GET | `/hybridflow-runner/harness-models/{harness}` | — | `{ models, activeModels, defaultModel }` |
| PUT | `/hybridflow-runner/harness-models/{harness}` | `{ activeModels, defaultModel }` | `204` |
| GET | `/hybridflow-runner/auth/status` | `?harness=…` (Claude by default) | `HarnessAuthStatusDto`; `404` when disabled or unsupported, `503` when the CLI yields no status |
| POST | `/hybridflow-runner/auth/login/start` | — | `HarnessLoginDto` with `url` |
| POST | `/hybridflow-runner/auth/login/code` | `{ code }` | `HarnessLoginDto` |
| POST | `/hybridflow-runner/auth/login/cancel` | — | `HarnessLoginDto` |
| POST | `/hybridflow-runner/auth/{harness}/key` | `{ key }` | `HarnessLoginDto`; `404` for a harness with no API-key sign-in, or where the deployment keeps it off |
| POST | `/hybridflow-runner/auth/{harness}/login/start` | — | `HarnessLoginDto` with `url` and `userCode` |
| GET | `/hybridflow-runner/auth/{harness}/login/status` | — | `HarnessDeviceLoginDto`; `409` with nothing in flight |
| POST | `/hybridflow-runner/auth/{harness}/login/cancel` | — | `HarnessLoginDto` |
| GET | `/hybridflow-runner/runner` | — | `{ runnerId, source }` — which runner this service is, and whether the environment pinned it (`env`), the state directory names it (`file`), or it names none (`none`) |

**Usage is per harness, and the payload is a list of windows.** It reports the quota for the
account the harness uses. For example, `?harness=codex` reports the ChatGPT plan used by Codex.
Omit `harness` to get the default harness's quota.
The payload is `{ windows: [{ windowMinutes, percentUsed, resetAtEpochSeconds }] }`,
tightest window first. Each window names its own duration, and the client derives its label
from the minutes. An empty list is a real answer — an account whose
plan reports no window — and reads as an unavailable quota rather than as a failure.

Where the figures come from differs per harness. Claude has no way
to see the rate-limit headers but to spend a **one-token probe** on the Anthropic API; Codex is a
read — `codex app-server` speaks JSON-RPC on stdio and `account/rateLimits/read` answers the snapshot
its own status line is drawn from. `codex exec` says nothing about an account: its stream carries
what one turn cost and no more. A probe the Claude quota refuses is read all the same: once a window
is spent the API answers it `429` with the same headers, so a full window reaches the client as a
full bar and not as a `503`. Muse is harvested and, where there is nothing fresh to answer, probed:
a host fresh off `muse serve` has observed no quota to report, so every turn's host is asked
`usage/read` as its turn ends and whatever `usage/changed` a turn emits is recorded as it lands —
and a read of this endpoint otherwise runs one minimal turn, one word on the cheapest model at no
reasoning effort, and records what that host observed like any turn's. The chain runner never
takes the probe: it reads the harvested figures to learn when a spent window lifts, where spending
a turn to ask would be spending quota to ask about quota.

Claude and Codex usage is cached for 30s server-side, and a Muse refresh is answered from figures
harvested less than 30s ago rather than from a second turn. `/hybridflow-runner/options` reports, for the Claude harness, the models the
CLI accepts (a curated alias list) and the efforts parsed from `claude --help`; for Codex it reports
the model catalogue and the reasoning levels `codex debug models` names; for Muse, the catalogue a
`muse serve` answers to `model/list` — each Spark beside its hidden `-contributor` twin — and the
protocol's closed effort tiers. The client never hard-codes a list that drifts from the installed
CLI; these catalogues are cached for 10 min. All of these
resolve under the same proxy caveat as usage — reach them as `/api/files/hybridflow-runner/…`.

Codex also offers the service tiers its catalogue advertises beside each plain model: for example,
`gpt-6.1-sol@priority` labelled “GPT-6.1 Sol · Fast”. The driver sends the slug with `-m` and the
tier as `service_tier`, on fresh and resumed turns alike. An explicit `@default` choice selects
Standard; a plain slug preserves the host's configured speed. Older catalogues with only
`additional_speed_tiers` remain supported. Reasoning levels, including `max`, `ultra`, and any
future value, come from the catalogue and are passed through as `model_reasoning_effort`.

Codex's `turn.completed.usage` is filed in the conversation and, for a played flow node, in the
boards' existing usage records. `input_tokens` and `output_tokens` become `inputTokens` and
`outputTokens`; `cached_input_tokens`, `cache_write_input_tokens`, and `reasoning_output_tokens`
become `cacheReadTokens`, `cacheWriteTokens`, and `reasoningTokens`. Cache counters are breakdowns
of Codex input, and reasoning is included in its output total; neither is added to the totals again.
No dollar cost is inferred. Older reports without these breakdowns still carry their totals.

`harnesses` lists each available harness and its models, effort levels and permission modes.
The first entry is the default harness, also named in `defaultHarness`. Its lists are repeated
at the top level for older clients.

`defaultModel` and `defaultEffort` are the harness defaults for agent publications that leave
those fields empty. Codex also publishes each model's supported reasoning levels. Legacy Codex
requests that omit both fields use the CLI defaults until a model preference is saved.

`permissionModes` is curated rather than parsed, and is the shorter list on purpose: the CLI's
`--permission-mode` also takes `acceptEdits`, `auto`, `dontAsk` and `plan`, but only `manual`,
`manualLive` and `bypassPermissions` are modes **this service** knows how to drive over the socket.
It is the set of values a `prompt` may carry, not the set the CLI understands — and `manualLive` is
not a value the CLI understands at all: see [Manual Live](/operation/worker/PROTOCOL/turn-control.md#manual-live).

The list is also **per deployment**: `KIAO_WORKER_HYBRIDFLOW_RUNNER_BYPASS_ENABLED=false` withdraws
`bypassPermissions`, and the endpoint then offers two modes rather than three. Withdrawing it from
the list is a courtesy to the toolbar, not the gate — every endpoint that takes a mode refuses it in
its own right; see [Withdrawing bypass](/operation/worker/PROTOCOL/turn-control.md#withdrawing-bypass).

And it is **per harness**, which is the sharper cut of the two: Codex publishes
`bypassPermissions` alone. Read `harnesses[].permissionModes` for the harness a conversation is bound to rather than the
top-level list.

## Model preferences

The model panels for Claude Code, Codex and Muse list each harness's full catalogue. The
agent picker uses `harnesses[].activeModels` and puts the default first. Selecting a column
records that exact model on the task or conversation. Pi uses a column per execution profile.

Initial preferences include the harness's existing default and up to two additional choices.
Claude Code starts with Opus, Sonnet and Haiku. Codex uses CLI priority and selects one entry
per model, with a speed tier included when the CLI sets it as the default. Muse keeps the
catalogue default resolved by the driver and prefers recent models across families and channels.

The worker saves a JSON document per harness under `.kiao-config/harness-models/` at the DCMS
root. A write requires the default to be one of the active model IDs. If a catalogue drops an
ID, the worker offers the active models still available and applies the initial rule if none
remain. A catalogue read leaves the saved preferences intact.

## Harnesses

An agent publication specifies a default harness and can support additional harnesses. A
conversation captures the selection at creation. `GET /hybridflow-runner/options` reports which
of `claude`, `codex`, `muse` and `pi` are available on this deployment.

**Offered is decided per request, from three things**, so that installing a CLI takes effect on the
next page rather than at the next restart: whether the deployment vetoed the harness
(`KIAO_WORKER_HYBRIDFLOW_RUNNER_{CLAUDE,CODEX,MUSE,PI}_ENABLED`, all defaulting to on), whether its CLI is on
the service's PATH, and whether the configuration panel has switched its row off. `harnesses` is
therefore a list that can shrink or grow while a service runs, and **can be empty**: a machine with
no harness CLI on it says so, and a client shows that rather than offering a harness whose first
prompt would come back `unknown_harness`.

**Disabling a CLI disables all of its features.** The deployment flag and the configuration
switch also gate auth checks, usage reads (including the chain runner's), and every sign-in
endpoint. Disabled harnesses answer `404` without invoking their CLI or probing their account.
The options response always includes `harnesses`, using `[]` when none are offered; a missing list
represents a legacy response. Dashboard refreshes the list after configuration changes. It offers
agent selection and sign-in and usage controls according to harness availability.

| | `claude` | `codex` | `muse` | `pi` |
|---|---|---|---|---|
| CLI | `claude --print --output-format stream-json` | `codex exec --json` | `muse serve` (MSP over stdio) | `pi --mode rpc` |
| Permission modes | `manual`, `manualLive`, `bypassPermissions` | `bypassPermissions` only | `manual`, `manualLive`, `bypassPermissions` | `manual`, `manualLive`, `bypassPermissions` |
| Asks before a tool call | yes, over the SDK control protocol | **never** | yes, over MSP approvals | yes, including nested Codemode calls |
| Can be told something mid-turn (`between`) | yes | no | yes, `turn/steer` | yes, `steer`; deferred `follow_up` |
| Session branching (fork) | yes, `--fork-session` | no — a fork carries the transcript, not the session | yes, `session/fork` | yes, native `clone` and `fork` |
| Quota (`/hybridflow-runner/usage`) | yes, a one-token API probe | yes, `codex app-server` → `account/rateLimits/read` | yes, harvested, else one minimal turn on the cheapest model | unavailable; turn cost is reported separately |
| Sign-in from the panel | yes | yes — device code or API key in Usage | yes — device code or API key in Usage | API key references in execution profiles |

**Codex offers bypass alone, and says so rather than pretending.** `codex exec` has no approval
channel: it never asks, and what stands in for the human is its sandbox, which bounds a turn rather
than putting a decision to anybody. A mode named Manual that asked nothing would be a lie told in a
dropdown, so the two manual modes are simply not offered. The consequence follows: a deployment with
`KIAO_WORKER_HYBRIDFLOW_RUNNER_BYPASS_ENABLED=false` publishes *no* mode for Codex and refuses every
turn on it — a harness that can only run unsupervised has nothing to offer a deployment that forbids
it.

**Codex is offered when installed and enabled.** `KIAO_WORKER_HYBRIDFLOW_RUNNER_CODEX_ENABLED`
defaults to `true`; availability also requires `codex` on the service's PATH and the configuration
panel's harness switch to be enabled. The other CLI harnesses use the same gates; Pi additionally
requires a valid execution profile and installation.

**A between is refused on Codex.** `codex exec` reads its prompt from stdin to end-of-file before the
turn starts, so there is no second channel into a running one. The message goes back to the box it
was typed in — `no_running_turn`-style refusal on the socket — rather than being queued for a turn
that will never read it.

## Signing the host's CLI in

`/hybridflow-runner/auth/login/*` signs in the `claude` CLI **of the service host** from a browser. The flow is
two round trips because the CLI's is: `start` spawns `claude auth login --claudeai`, which prints an
authorize URL and then blocks reading the code from stdin; the user opens that URL, authorises, and
copies the code the callback page displays; `code` writes it to the stdin still held open from the
first call. One `claude` process is parked between the two.

- **At most one sign-in is in flight.** Starting another replaces it — an abandoned attempt's code
  is unusable anyway. An unfinished one is killed after 10 minutes, and on service shutdown.
- **`code` with nothing in flight is `409`**; a code that is empty, over 512 chars, or contains a
  newline is `400`, refused before it reaches a line-oriented stdin.
- **A refused code is not an HTTP error.** Like `/git/*`, the step answers `200` with
  `{"ok": false, "message": "<what the CLI said>"}`. The same holds for a `start` that yields no URL.
- **The three POSTs are enabled by default; `KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_LOGIN_ENABLED=false`
  makes them `404`.** Completing the flow binds the host's CLI to whichever account authorises it.
  `/hybridflow-runner/auth/status` stays reachable either way, and reports
  the flag as `loginEnabled` so one request tells a client both that a sign-in is needed and whether
  it may offer one. Disabling Claude itself makes all four routes return `404`.

`claude auth status --json` **exits 1 when logged out** while still printing a well-formed status,
so the exit code is not the signal — a parsable payload is. Reading it otherwise would turn the
endpoint's most useful answer into a `503`. The code is never logged.

`GET /hybridflow-runner/auth/status?harness=codex` runs `codex login status` using the worker's
environment and credential store. Exit 0 means credentials are present; exit 1 with the explicit
`Not logged in` message means signed out. Other failures return `503`, without exposing the CLI's
output (which may include part of an API key). Dashboard checks this before creating a Codex
conversation and before sending a new turn; a signed-out result opens Usage without creating the
conversation or sending the message. Failed status reads block the action until a retry.
An explicit `CODEX_API_KEY` also satisfies the preflight, matching `codex exec`; configured
workload identity retains the CLI's precedence over that key.

`POST /hybridflow-runner/auth/{harness}/login/*` is the device flow, for a harness whose CLI signs in that
way — Muse's `login` or Codex's `login --device-auth`, which prints a page to open and a code to
enter or confirm, then waits for approval. `start` spawns it and returns both; `status` is polled while it waits and answers
`{"pending": false, "ok": …}` once it has exited, with the CLI's own sentence; `cancel` abandons
the wait. At most one flow is in flight — starting another replaces it — a finished wait is
consumed by its read, and a `status` past that is `409`. The endpoints answer per harness and are
enabled by default; `KIAO_WORKER_HYBRIDFLOW_RUNNER_MUSE_LOGIN_ENABLED=false` or
`KIAO_WORKER_HYBRIDFLOW_RUNNER_CODEX_LOGIN_ENABLED=false` makes the respective harness's endpoints `404`.
Each harness has its own parked flow;
cancel, expiry and worker shutdown stop its CLI and local descendants.

`POST /hybridflow-runner/auth/{harness}/key` is the same idea in one round trip, for whoever already holds an
API key — Muse's `auth set --api-key-stdin` or Codex's `login --with-api-key`, which reads the key
off stdin so it never lands in shell history. The key goes up in the body, the CLI's own sentence comes back in
`HarnessLoginDto`, and a refused key is `{"ok": false}` rather than an HTTP error, as above. The key
is never logged, and the endpoint stands under the same flag.

Each options entry advertises its harness's offer as `login` — the shapes, whether the deployment
exposes them, and the host command where it does not — so the usage panel learns from the request
it already makes both that a sign-in exists and whether it may offer one.

Pi resolves exact installations and connections through independent execution profiles, rather than PATH defaults. Its model-specific options, sessions, permissions and deferred messages are described in [Pi execution profiles](/operation/worker/PROTOCOL/pi.md).
