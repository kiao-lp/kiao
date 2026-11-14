---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# The toolbox

← [worker wire protocol](/operation/worker/PROTOCOL.md).

The configuration panel: what this service can install on the machine it runs on, and which MCP
servers a turn is handed. TypeScript types: `reference/kiao-worker/src/toolbox-types.ts`.
See the [toolbox design](../docs/solution-design/toolbox.md) for catalogue recipes, ownership
and runtime resolution.

| Method | Path | Body | Answer |
| --- | --- | --- | --- |
| `GET` | `/toolbox` | — | `Toolbox` |
| `POST` | `/toolbox/install` | `{ ids }` | `202 ToolboxJob` |
| `POST` | `/toolbox/uninstall` | `{ ids }` | `202 ToolboxJob` |
| `POST` | `/toolbox/registration` | `{ ids, enabled }` | `Toolbox` |
| `GET` | `/toolbox/jobs/{id}` | — | `ToolboxJob` |

**The wire carries ids and nothing else.** No command, no package name, no version. What each id
means is the toolbox catalogue — `pub.json`, embedded in the binary and refreshed at every
deployment, plus whatever catalogue files the deployment staged beside it — with one recipe per
platform; an id it does not declare is `400`, and that is the whole of what bounds this surface.
It is the same bargain [file actions](./actions.md) strike — a declaration the deployment owns,
and a client that can only name an entry of it.

```jsonc
// GET /toolbox
{
  "enabled": true,              // false: this deployment configured no install prefix
  "platform": "debian",         // which recipes apply here — "debian" | "alpine" | "generic"
  "prefix": "/home/user/.local/share/kiao/toolbox",
  "strict": true,               // at least one server registered, so a turn gets exactly these
  "components": [
    {
      "id": "fetch", "kind": "mcp", "title": "fetch",
      "role": "web page to markdown, with pagination for long documents",
      "channel": "uv",
      "state": "installed",
      "version": "0.6.2",
      "installedAt": "2026-08-31T09:12:04Z",
      "registered": true,
      "tools": 1, "toolBytes": 1204,
      "probedAt": "2026-08-31T09:12:31Z"
    }
  ],
  "job": { "id": "job-…", "op": "install", "ids": ["uv", "fetch"], "state": "done",
           "log": "…", "startedAt": "…", "endedAt": "…" }
}
```

`state` is what the row offers: `installed` (present, and this service put it there, so it can take
it away), `present` (present, but somebody else put it there — nothing to install and nothing to
remove), `available`, `blocked` (a precondition is not met; `reason` says what to go and do),
`unavailable` (no recipe on this platform), `missing` (the ledger records an install the machine no
longer has; installing again repairs it), `unresponsive` (installed, and it does not answer when it
is started).

`kind` is `runtime` or `mcp`, and `runtime` is the wider of the two on purpose: a JDK and the Node
LTS, which a *turn* runs, and `ffmpeg`, which the **service** runs for its own account — it is what
saves a video's segments, and no turn ever spawns it. There is no third kind because nothing would
read it: the kind decides which section a row is in and whether its switch means *handed to a turn*,
and ffmpeg wants a section of neither and no switch at all. What a component is *for* is `role`,
which is a sentence and can say it properly. A `424` from the media endpoint is answered by
installing it here (see [Media](./media.md)).

**Installed is not working, and the wire says which.** An MCP server is started and made to complete
an `initialize`/`tools/list` handshake at the end of its install; `tools`, `toolBytes` and `probedAt`
are that answer, and `unresponsive` with a `reason` quoting the server's own stderr is the other one.
A package manager reporting success proves that files were written and nothing more — a console
script that is the package's CLI rather than its server, an import that raises, a key the server
refuses to run without, all install perfectly and answer nothing. Installing again is what re-asks
the question.

`registered` is a separate question from being installed, and both directions are meaningful: a
server can be on the machine and switched off — which is worth doing, because every tool it declares
is sent with every single request a turn makes, and `tools`/`toolBytes` are what that costs. What it
cannot be is switched **on** while it is `unresponsive`: `POST /toolbox/registration` answers `400`
for a server whose last handshake failed, because registering it would hand every turn a name with
nothing behind it — the same failure the handshake check exists to catch, through the other door.

**`harness` is the second row that carries a switch.** A runtime that names one — `claude-cli` says
`"harness": "claude"`, `codex-cli` says `"codex"` — is a harness's CLI, and `registered` on it means
*offered in the chat tab* rather than *handed to a turn*. It reads the other way round from a
server's: a harness nobody has said anything about is `registered: true`, because the CLI is on the
machine and the panel's silence is not a reason to hide it. That is the control for a binary this
panel did not install — one baked into an image, one that was there first — where `state` is
`present` and there is no uninstall to offer. `GET /hybridflow-runner/options` is where the consequence shows:
a harness switched off here, or whose CLI is not on the PATH, is not in `harnesses` at all, and an empty
`harnesses` is the honest answer for a machine with no harness CLI on it.

**An install is a job, not a request held open.** `POST /toolbox/install` resolves the dependency
closure server-side, starts the work on a goroutine and answers `202` at once; the client polls
`GET /toolbox/jobs/{id}` while `state` is `running` and shows `log` growing. Only the job in hand is
kept — an older id is `400`. A second install while one runs is `400`: installs are serial. A
component already installed is skipped unless it is named explicitly, which is how a `missing` row is
repaired.

`POST /toolbox/uninstall` refuses two things, and both are the same principle — the ledger
(`<state>/toolbox.json`) is the boundary of what this panel owns. Something this service did not
install is not its to remove, and something another *installed* component still requires is not
either. Asked for a component and its dependency together, it removes the dependent first.

`POST /toolbox/registration` touches nothing on disk, so it answers the whole new `Toolbox` rather
than a job.

**The consequence a client has to state.** `--mcp-config` is passed with `--strict-mcp-config`, so
the moment anything is registered here a turn is handed *exactly* these servers and the ones
registered with the `claude` command itself stop arriving. That is what `strict` is for.
