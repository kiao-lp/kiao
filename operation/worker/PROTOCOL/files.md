# Files

← [worker wire protocol](/operation/worker/PROTOCOL.md) · assumes the index (auth, prefixes).

| Method | Path | Query / body | Response |
|---|---|---|---|
| GET | `/getFile` | `path` | file bytes, or a zip of the folder |
| POST | `/upload` | multipart `path`, `file` | — |
| PUT | `/update` | `path`, multipart `file` | — |
| DELETE | `/delete` | `path` | — |
| POST | `/deleteBatch` | `{ paths: string[] }` | `LinkFixReport[]` |
| GET | `/list` | `path` | `FileDto[]` |
| GET | `/listRecursive` | `path` (repeatable) | `{ files: FileDto[], truncated: bool }` |
| GET | `/info` | `path` | `FileDto` |
| POST | `/createFolder` | `path` | — |
| POST | `/rename` | `path`, `newPath` | — |
| POST | `/moveBatch` | `{ paths?: string[], targetFolder?: string, items?: { from, to }[] }` | `LinkFixReport[]` |
| POST | `/copyBatch` | `{ paths?: string[], targetFolder?: string, items?: { from, to }[] }` | `CopyResultDto[]` |
| GET | `/search` | `path`, `query` | `{ results: SearchDto[], truncated: bool }` |
| POST | `/reindex` | `{ paths: string[] }` | `ReindexResultDto` |
| POST | `/staging` | — | `StagingDto` |
| DELETE | `/staging` | `path` | — |
| GET | `/fileOptimizations` | `path` (default: the root) | `FileOptimizationsDto` |
| POST | `/deduplicate` | `{ paths: string[], target: string }` | `DeduplicateResultDto` |
| GET | `/diskUsage` | — | `DiskUsageDto` |
| GET | `/storeInfo` | — | `StoreInfoDto` |

`/getFile` serves a regular file with `Accept-Ranges: bytes`, `Content-Length`, `Last-Modified` and
`Cache-Control: no-cache`, and honours `Range` (`206` with `Content-Range`) and `If-Modified-Since`
(`304`). A client downloading a large file — an episode over a mobile connection — therefore has a
total to show progress against and a way to resume where it stopped, while an editor re-reading a
document always revalidates rather than trusting a cached copy. The body and its `Content-Type` are what they
always were; a directory path still streams a zip, with `Content-Disposition: attachment;
filename="<folder>.zip"`, and a regular file still carries no `Content-Disposition` at all.

`/upload` and `/update` cap the **whole request body** at 100 MiB, envelope included — the same
figure the production reverse proxy enforces, so the two refuse the same requests and a service run
without a proxy in front of it is bounded all the same. `/upload` answers an oversize body `413`
with the limit spelled out. `/update` answers `500`, which is what it answers to every failure on
purpose: a client reads `404` or `500` from `/update` as "the file is not there yet" and retries the
write as an `/upload` — and that call is the one that comes back `413` naming the number.

`/storeInfo` answers where the store is on the machine serving it: `rootPath` is the storage root
as an absolute host path, resolved from whatever the deployment configured. It is the prefix that
turns a root-relative path — everything else on the wire — into one a terminal, an editor or an
agent sitting beside the service would recognise, and it is constant for the life of the process, so
a client asks once. It is not a path the file endpoints accept: they are root-relative and stay so.

`/delete` (and each path of `/deleteBatch`) removes **a whole entry**: a file with its subsidiaries
and its `.config.json` settings sidecar, or a directory with everything under it. Deleting something
that is not there succeeds — the caller asked for it gone, and it is. The one refusal is the storage
root itself, which an empty path, `/` or `.` all resolve to: `400`, since a recursive delete there
would take the store with it.

A `/deleteBatch` therefore never needs a path per descendant: a folder covers what is under it for
the removal *and* for the link fix, since a path token carries its child suffix and an operation on
`folder` rewrites every reference to `folder/a/b.md`. A batch that names both anyway still gets one
report per requested path, in order — the covered ones empty, because what was rewritten for them is
reported under the ancestor that did it.

`/listRecursive` answers what removing the requested paths would take with it: each of them, then
everything under it, depth-first and name-ordered. `path` repeats, so a whole selection is one round
trip — a client must never walk the store itself, which on a folder holding a `node_modules` is tens
of thousands of requests. The walk stops at 500 entries and says so with `truncated`; past that the
honest answer is "more than you can read". A path that is not there contributes nothing, exactly as
deleting it succeeds. Subsidiaries are hidden as `/list` hides them (they go with their main file
either way), the state directory never appears, and the entries carry no `indexed` flag and no
companion family: a scope is about what goes, not about how to present it.

Below a requested path, a folder the store declares out of bounds under `[search]` is listed and not
descended into — it goes with the delete, and describing the delete must not send the walk through a
dependency tree or a network mount nobody pointed it at. What it holds is left uncounted, so the
answer comes back with `truncated`, which means "there is more than this shows" whether the walk
stopped at the cap or at a declaration. Named in the request, the folder is described in full like
anything else asked for by name.

`/copyBatch` takes the same request shape as `/moveBatch` and copies **whole entries**: a file with
its subsidiaries, or a directory with everything under it, walked server-side so a client never
makes one round trip per file. Three rules distinguish it from a move, and they are the contract:

- **It never overwrites.** A destination whose name is taken gets a `" (copy)"` — then
  `" (copy 2)"`, `" (copy 3)"`, … — suffix inserted before the extension, or appended when the name
  has none (a dotfile's leading dot is not an extension). Each `CopyResultDto` reports
  `{ from, to }` with `to` being the name that was actually used, which is how a caller learns it.
  Pasting into the source's own folder therefore duplicates rather than being a no-op, unlike a
  move, which skips an entry already at its destination.
- **A destination at or under its own source is refused** with `400`, before anything is written —
  that shape is the one a recursive copy can never finish.
- **No link-fixing runs**, so the response is not `LinkFixReport[]`: a copy only creates paths that
  nothing in the tree can already refer to.

`/fileOptimizations` answers **what the store is carrying that it need not be**: the files stored
more than once, and the biggest ones. Both come out of one walk, because they are the same question
asked twice and a store large enough for either to be interesting is one nobody wants walked twice.

```json
{ "duplicates": [ { "hash": "9f86d081…", "size": 2048, "wasted": 2048,
                    "files": [ { "path": "assets/IMG_4471.png", "size": 2048, "lastModified": 1700000000000 },
                               { "path": "scratch/logo.png",    "size": 2048, "lastModified": 1700000000000 } ] } ],
  "largest": [ { "path": "media/intro.mp4", "size": 418000000, "lastModified": 1700000000000 } ],
  "scanned": 8123, "truncated": false }
```

Identity is **size then content**. Files are grouped by size and only a group of two or more is
hashed, which is what makes the pass affordable — a store's sizes are almost all unique, so the bytes
actually read are a small fraction of it — and it is also why a reported group is exact rather than a
hash collision away from wrong: every file in one has been read. Candidate groups are hashed biggest
waste first (`size × (copies − 1)`), so a scan that runs out of its hashing budget has spent it on
the findings worth having, and says so with `truncated` rather than reporting a group it did not
verify. `wasted` is on the wire because it is the order the groups come in.

Two kinds of file are left out, and both would be noise. An **empty** file is identical to every
other empty file, so the placeholders that keep a folder alive are not a duplicate group. A
**subsidiary** or a settings **sidecar** sitting beside its main file — `<doc>.index.md`,
`<doc>.config.json` — goes with that file everywhere else, and its main file being a duplicate
already covers it; an orphaned one, whose document is gone, is a file like any other.

The walk is search's, so it stays out of what the store declares under `[search]` in its
`.kiao-files`: nobody pointed this at their dependency tree, and its copies are not theirs to
remove. `scanned` counts the files considered — the denominator that
tells "no duplicates" apart from "the walk never got there" — and `truncated` means "there is more
than this shows", whether the walk stopped at a cap or at a declaration. It is a **slow** endpoint by
design, asked for by a person who opened a panel, and never on a path a client takes on its own.

`/deduplicate` reduces the files it names to the one at `target`, and answers what it did:

```json
{ "kept": "assets/logo.png", "removed": ["assets/IMG_4471.png", "scratch/logo.png"], "linkFixes": [ … ] }
```

It is a **move of every copy onto the target**, not a delete of the others, and that is the contract
rather than an implementation detail: a move is what the link fixer understands, so every reference
to a copy that goes becomes a reference to the one that stays instead of a link into nothing — hence
`LinkFixReport[]` in the response, as on `/moveBatch`. Overwriting the target with a copy is a no-op
on disk, the bytes having just been checked to be the same. A copy already at `target` is left where
it is.

Two refusals stand between the request and the filesystem, and both are **409** rather than 400: the
request was well formed and was true when the scan produced it, and a store is edited under the
reader's feet. The files must **still** be identical — re-hashed on the spot, never trusted from the
scan — and `target` must be one of them or free, so a name chosen from one copy and a folder chosen
from another can never destroy a stranger that has since taken that path. Fewer than two paths, no
target, or a path that is not a regular file are 400s; a path that has stopped existing is a 404.

`/search` reads binary documents through a sibling index it refreshes on the fly, so hits in them
are reported against the original file path, never against the index that was scanned. What that
index *is* — and how a client asks for one — is [Document indexes](/operation/worker/PROTOCOL/search-indexes.md#document-indexes).
