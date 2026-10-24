# File actions, media and the toolbox

← [worker wire protocol](/operation/worker/PROTOCOL.md) · assumes the index and [file endpoints](/operation/worker/PROTOCOL/files.md).

## File actions

This section is the normative wire contract. For how the system fits together see
[file-actions](/docs/solution-design/file-actions.md); for how to add one, the
[file-actions](/.agents/skills/file-actions/SKILL.md) skill.

| Method | Path | Query / body | Response |
|---|---|---|---|
| GET | `/actions` | — | `ActionDescriptor[]` — every declared action |
| GET | `/actions` | `path` | `ActionDescriptor[]` — the ones applying to that entry; unknown path → 404 |
| POST | `/actions/run` | `{ id, path, params? }` | `ActionResult` |

```ts
interface ActionDescriptor {
    id: string;          // e.g. "audio.speech"
    label: string;       // shown in the menu, verbatim
    group?: string;      // menu sort key, e.g. "6-actions"
    order?: number;
    appliesTo: { extensions?: string[]; directory?: boolean };
    params?: { name: string; label?: string; type: 'string' | 'boolean' | 'enum';
               values?: string[]; default?: unknown }[];
}
interface ActionResult { ok: boolean; message: string; changedPaths: string[]; }
```

**Applicability is the contract.** Both keys of `appliesTo` are optional and are AND-ed, so an
empty rule matches any entry. `extensions` matches case-insensitively against the end of the *file
name* (not the path), which is what makes compound extensions like `.ttst.md` and `.mlunit.json`
work. `directory`, when present, requires the entry to be (or not to be) a directory. The
vocabulary stays this small on purpose: everything in it is decidable from `{ path, isDirectory }`,
which a client already holds, so a context menu can be built without a round trip. That means the
rule is implemented twice — `actionApplies` in `files/actions.go` and `appliesTo.ts` in Dashboard — and
**this paragraph, not either implementation, is what they must agree with.**

Which service implements an action is deployment configuration and is never disclosed: a client
names an action by id and this service routes it. Running one forwards the caller's `Authorization`
header and `X-Request-Id` to the provider. Failures split in two: an operation the provider refused
comes back `200 {"ok": false, "message": "…"}` (the same choice `/git/*` makes for a failed git
command), while a provider that cannot be reached or that exceeds the 10-minute budget is a `502`.
An unknown action id is `404`, and a `path` escaping the storage root is `400`, refused before
anything leaves the service.

## Media

A video's segments saved as files of their own. TypeScript types:
`reference/kiao-worker/src/media-types.ts`.

| Method | Path | Body | Answer |
| --- | --- | --- | --- |
| `POST` | `/media/saveSegments` | `{ path, segments: MediaSegment[] }` | `202 MediaJob` |
| `GET` | `/media/jobs/{id}` | — | `MediaJob` |
| `DELETE` | `/media/jobs/{id}` | — | `MediaJob` — the save stopped where it stands |

```ts
interface MediaSegment { name: string; fromMs: number; toMs: number; }
interface MediaJob {
    id: string;
    path: string;                  // the video or the recording cut
    state: 'running' | 'done' | 'failed' | 'stopped';
    files: string[];               // where the segments are saved, in the order they are written
    done: number;                  // how many of them are
    current?: string;              // the one being written
    progress: number;              // 0 to 1 through the whole save, by the length of what is encoded
    error?: string;
    startedAt: string;
    endedAt?: string;
}
```

Each segment becomes `<the source's folder>/<name>.mkv`: AV1 and Opus in Matroska, encoded by
ffmpeg. **`name` is the file's name, not the segment's** — Dashboard sends the segment's name as the
store names a file after a title (`toStoreName`) — and it is refused with `400` if it is empty, a
path, hidden, or has a space at either end; so are two segments landing on one file and a segment
landing on the source itself, compared without case, as a Drive or a Windows disk compares names.

**`fromMs` and `toMs` are where the images are**, not the segment's stored ends: the start of its
first image and the end of its last, fractional where the file's own times are. ffmpeg is asked for
that window drawn in by half a millisecond at both ends, which keeps the first image and leaves out
the next one whichever way a container rounded their times; the input is seeked and re-encoded, so
a segment starts on its own image and not on the key image before it.

A file already at that name is **replaced whole**: each segment is written under a hidden name
beside its destination and renamed over it once ffmpeg has finished, so a save that fails or is
stopped leaves that file as it was — and keeps the segments it had saved before it. Everything that
can be refused is refused before the first segment starts.

**`424` is a machine with no ffmpeg able to do it**: none at all, one without an AV1 encoder
(libsvtav1, then libaom-av1, then librav1e) for a source with a picture, or one without an Opus
encoder for a source with a sound. The body is the sentence to show. ffmpeg is the toolbox's
`ffmpeg` runtime — looked for in the toolbox's prefix first and on the PATH after, at every save — so
installing it (`POST /toolbox/install {"ids":["ffmpeg"]}`) is what answers a 424, and it is what
Dashboard offers. A file ffmpeg cannot read at all is `400`.

One save at a time, as there is one install at a time: a second while one runs is `400`. Only the
last save is kept, and an older id is `400`.

## The toolbox

The configuration panel: what this service can install on the machine it runs on, and which MCP
servers a turn is handed. TypeScript types: `reference/kiao-worker/src/toolbox-types.ts`.

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
It is the same bargain `/actions` strikes — a declaration the deployment owns, and a client that
can only name an entry of it.

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
installing it here (see *Media*).

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

**`agent` is the second row that carries a switch.** A runtime that names one — `claude-cli` says
`"agent": "claude"`, `codex-cli` says `"codex"` — is an agent's CLI, and `registered` on it means
*offered in the chat tab* rather than *handed to a turn*. It reads the other way round from a
server's: an agent nobody has said anything about is `registered: true`, because the CLI is on the
machine and the panel's silence is not a reason to hide it. That is the control for a binary this
panel did not install — one baked into an image, one that was there first — where `state` is
`present` and there is no uninstall to offer. `GET /hybridflow-runner/options` is where the consequence shows:
an agent switched off here, or whose CLI is not on the PATH, is not in `agents` at all, and an empty
`agents` is the honest answer for a machine with no agent CLI on it.

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
