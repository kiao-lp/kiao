# Config documents and git

← [worker wire protocol](/operation/worker/PROTOCOL.md) · assumes the index.

## Config documents

| Method | Path | Query / body | Response |
|---|---|---|---|
| GET | `/config/{name}` | — | the document, verbatim JSON |
| PUT | `/config/{name}` | the document as JSON | `204` |

The documents Dashboard keeps outside its content: `dashboard.json` (feature flags, hand-edited),
for how the UI was left (rewritten as panes are arranged) `dashboard-view-state.json` and
`dashboard-view-state-small.json` — one per screen size, since what they hold is the layout and the
client picks by viewport width — and `runner.json` (`{"runnerId": "…"}`), which runner this service
is, written by the runners panel's "it's me" button. They are served from the
service's own state directory — `KIAO_WORKER_STATE_PATH`, `<root>/.kiao-config` by default —
and **not** through the file API, which refuses every path landing in that directory (400) and
leaves it out of every listing. So they never appear in the file browser, in `git status`, or in a
published store, even though the directory now sits in the data root. Everything else about them is
the client's business: the service stores whatever JSON it is given.

Saving `dashboard.json` reinstalls the store's skills, and saving `runner.json` re-reads which runner
the service is — the next heartbeat and the next Play — so both take effect without a restart.

`{name}` is an **allow-list of exactly those four names**, not a pattern. The migration ledger and the
conversation registry sit in the same directory; a name that reached them would turn a toolbar's
open/closed state into a way of rewriting which migrations a store thinks it has run. An unknown name is `404` — the
same answer as a document that was never written, which is what a client seeds its defaults on. A
body that does not parse as JSON, or one over 1 MB, is `400`.

## Git

| Method | Path | Query / body | Response |
|---|---|---|---|
| GET | `/git/status` | — | `GitStatusDto` |
| POST | `/git/fetch` | — | `GitStatusDto` (after a fetch) |
| POST | `/git/stage` | `path` | `GitResultDto` |
| POST | `/git/unstage` | `path` | `GitResultDto` |
| POST | `/git/stageBatch` | `{ paths }` | `GitResultDto` |
| POST | `/git/unstageBatch` | `{ paths }` | `GitResultDto` |
| POST | `/git/stageAll` | — | `GitResultDto` (`add -A` over the whole tree) |
| POST | `/git/unstageAll` | — | `GitResultDto` (index back to HEAD, work tree kept) |
| POST | `/git/revert` | `path` | `GitResultDto` |
| POST | `/git/revertAll` | — | `GitResultDto` (unstaged changes discarded, untracked deleted, index kept) |
| POST | `/git/commit` | `{ message, amend }` | `GitResultDto` |
| POST | `/git/push` | — | `GitResultDto` |
| POST | `/git/pull` | — | `GitResultDto` |
| POST | `/git/consolidate` | `{ message, pushRemote }` | `GitResultDto` |
| GET | `/git/original` | `path` | text (HEAD content) |
| GET | `/git/working` | `path` | text (working-tree content) |
| POST | `/git/save` | `{ path, content }` | `GitResultDto` |

A failed git command is **not** an HTTP error: it comes back `200` with
`{"ok": false, "output": "<combined stdout/stderr>"}`.

`/git/consolidate` is the one call that rewrites history: it squashes the branch into a single root
commit, optionally force-pushes that rewrite to the upstream (`pushRemote`), then expires the
reflogs and prunes every unreachable object — the point being the disk space that history holds.
Its `output` is a report (what was squashed, what was pushed, before/after size, which refs still
hold older commits), not raw git output. It leaves the index and the working tree untouched, it
answers only when the repacking is done — minutes on a large store, so give it a proxy timeout to
match — and a requested push that fails stops it before anything is pruned, leaving the old commits
recoverable from the reflog.
