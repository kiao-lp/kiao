---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Git

← [worker wire protocol](/operation/worker/PROTOCOL.md).

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
