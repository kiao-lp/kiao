---
name: file-actions
description: This skill should be used when the user asks to "add a file action", "create a server action", "add an operation on a file", "extend the context menu with a server operation", "write an action provider", "add a manifest entry", or works with the worker action manifest, action providers, appliesTo rules, or files under operation/worker/internal/files/actions.go.
---

# File Action Authoring

A file action is an operation on a store file offered in the file browser's context
menu and executed by the service that owns it. Adding one is a provider endpoint
plus a manifest entry: no Go, no Dashboard code.

For the concepts — the run from right-click to refresh, the three contracts, why
that shape, when it is *not* an action — see
[file-actions](../../../docs/architecture/file-actions.md). This skill is the procedure.

## 0. Is it an action?

- Needs the server, reachable from a path alone → action (this skill).
- Needs what is loaded in the tab (renderers, editor state) → plugin context-menu
  entry, not an action.
- Must exist outside production → actions only exist where a manifest is wired,
  which today is production alone; anywhere else the menu shows nothing. Settle that
  before building.

## 1. The provider endpoint

A plain HTTP endpoint taking the path the user acted on, plus the declared
parameters. worker calls it as `POST <provider>` with `Content-Type: application/json`:

```json
{ "path": "units/cell-division/intro.ttst.md", "params": {} }
```

`params` is `{}` when the action declares none — never `null`. worker forwards the
caller's `Authorization` header and `X-Request-Id` with the call, and waits up to
10 minutes.

Answer `200` with the result, whatever happened to the *operation*:

```json
{ "ok": true, "message": "Speech generated", "changedPaths": ["units/cell-division/intro.mp3"] }
```

Rules:

- **Refuse with `200 {ok: false, message}`, never with an error status.** A broken
  reference, a missing voice, a TTS refusal — the message is what the user acts on.
  worker passes a 2xx answer through verbatim.
- **A non-2xx never reaches the client as a status.** worker turns it into
  `{ok: false, message: "<your message or error> (HTTP <n>)", changedPaths: []}`.
  Reserve non-2xx for genuine faults (bad request, unreachable store) via the
  service's error handler; the status decides what happened, the body only supplies
  the wording.
- **`changedPaths` are store-root-relative paths** the client should refresh: the
  files written, or the folder when the writes scatter across it (an export names the
  unit's folder). Name them on a refusal too when the attempt left writes behind.
- **Read and write the store through worker, on the caller's token.** Build the
  store client per request from `req.headers.authorization` — no service account,
  no singleton holding one user's credential. Both services require the same realm
  role, so the forwarded token already carries it.
- **Validate input, including `params` arriving as `null`.** Accept `{}` and `null`
  as "no parameters".

The shape to mirror is the stub in
[TestRunActionForwardsToProvider](../../../operation/worker/internal/files/actions_test.go):
one route per action id, `{path, params}` in, `{ok, message, changedPaths}` out,
per-request store client built from the forwarded `Authorization` header, operation
refusals as `200 {ok: false}` and genuine faults to the error handler.

## 2. The manifest entry

The manifest is the JSON file named by `KIAO_WORKER_ACTIONS_PATH`, provided by the
deployment. One entry per action:

```jsonc
{ "id": "audio.speech", "label": "Generate speech (MP3)", "group": "6-actions", "order": 10,
  "appliesTo": { "extensions": [".ttst.md"] },
  "params": [{ "name": "voice", "type": "enum", "values": ["alice", "bakin"], "default": "alice" }],
  "provider": "http://localhost:18083/api/actions/audio.speech" }
```

Field rules (enforced at startup — a bad manifest aborts the start, it never serves
half-understood):

- `id`: required, unique. `label`: required, shown in the menu verbatim.
- `provider`: required, absolute URL. Never sent to a client.
- `group`/`order`: menu sort keys. `group` matches the numeric groups the browser
  uses; absent groups sort as `6-actions`, after everything the browser offers.
- `appliesTo`: both keys optional, AND-ed; `{}` matches any entry.
  - `extensions`: suffix match on the file **name** (not the path), case-insensitive.
    Compound extensions work (`.ttst.md`, `.mlunit.json`); a folder named `notes.md`
    does not lend its name to its children.
  - `directory`: when set, the entry must (or must not) be a directory.
- `params`: each needs `name` and `type` (`string`, `boolean`, `enum`); `enum`
  needs `values`. `label` falls back to `name`. `default` seeds the prompt;
  without one, enum takes its first value, boolean `false`, string `""`.

The rule vocabulary is implemented twice — `actionApplies` in
[actions.go](../../../operation/worker/internal/files/actions.go) and `appliesTo.ts` in
Dashboard — with the same test table on both sides. Adding an action never touches
either; extending the vocabulary touches both plus PROTOCOL.md, and is meant to be
that expensive.

## 3. Dashboard: nothing to do

No code, no plugin, no registration. What happens on its own:

- Descriptors are fetched once (`client.listActions()`) and each becomes a menu
  entry under plugin id `server-actions`.
- The menu is built synchronously from the local rule evaluation — no round trip
  per right-click.
- An action only offers on a **single** selection with a pointed file. There is no
  multi-selection and no empty-area invocation.
- Declared params open one generic prompt (enum → Select, string → Input,
  boolean → Switch); no params runs on the click.
- The run shows a loading toast, then success/error from `message`, and refreshes
  the file list when `changedPaths` is non-empty.

The files, for reading only: `exchange/dashboard/src/cms-core/files/actions/`
(`useServerActions.ts`, `appliesTo.ts`, `ActionParamsModal-cmp.tsx`,
`ServerActions-cmp.tsx`).

## 4. Wire the deployment

- Set `KIAO_WORKER_ACTIONS_PATH` to the manifest and restart worker: the catalog
  loads once at startup, there is no reload.
- Blank/unset disables the feature: `GET /actions` answers `[]`, every run is an
  unknown action, the menu is unchanged. That is the state of every environment
  without a manifest.
- The provider URL is per environment: loopback where both services share a host,
  service name where they do not.

## 5. Tests

- **Provider**: test the endpoint like any route — happy path, each refusal as
  `200 {ok: false}` with the message and the `changedPaths` the attempt left, and
  input validation (`params` missing, `null`, wrong shape).
- **worker** (only when touching it, which adding an action does not): the
  applicability table in
  [actions_test.go](../../../operation/worker/internal/files/actions_test.go) mirrors
  Dashboard's `appliesTo.test.ts` — keep both in step, with PROTOCOL.md as the
  arbiter.
- **By hand** against a worker with the manifest (paths are store-root-relative):
  `GET /actions` lists the catalog without provider URLs; `GET /actions?path=…`
  filters to one entry (unknown path → 404); `POST /actions/run` with
  `{id, path, params}` runs it (unknown id → 404, bad body or escaping path → 400,
  unreachable provider → 502, refused operation → `200 {ok: false}`).

## 6. Verify

```bash
go build ./... && go vet ./... && go test ./...     # from operation/worker, when touched
npm test                                            # on the provider, from its directory
```

Other callers of a new action, for free: any `WorkerClient.runAction` call (an editor
Export button runs its export this way) and any MCP tool built on `files.runAction`.
