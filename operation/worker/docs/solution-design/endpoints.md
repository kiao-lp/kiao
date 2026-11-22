---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Endpoints

← [worker](/operation/worker/README.md) · assumes the index (contract, auth).

File store: `GET /getFile`, `POST /upload`, `PUT /update`, `DELETE /delete`, `POST /deleteBatch`, `GET /list`,
`GET /listRecursive`, `GET /info`, `POST /createFolder`, `POST /rename`, `POST /moveBatch`, `POST /copyBatch`, `GET /search`,
`GET /diskUsage`, `GET /storeInfo`.

Documents: `POST /reindex`.

Store hygiene: `GET /fileOptimizations`, `POST /deduplicate`.

`POST /copyBatch` copies whole entries —
a file with its subsidiaries, or a directory with everything under it — server-side, so a client
never walks a tree file by file.

`POST /unzip` extracts an archive into its own folder — the endpoint behind Dashboard's question
after a zip is imported.

`POST /reindex` converts the documents at or under the given paths into their sibling index —
Markdown for a document, CSV for a workbook — which is the same conversion `/search` performs on
its own for anything missing or out of date. Asking for it is what covers the two cases search
does not: doing a whole folder now rather than on the next search, and rewriting an index that is
current but uses a supported suffix other than the converter's output format. Neither overwrites an index a
person wrote. It is the endpoint behind Dashboard's *Rebuild search index* context-menu command.

The [Git contract](../../PROTOCOL/git.md) owns the Source Control endpoints and result semantics.

Hybridflow-runner: `GET /hybridflow-runner/usage`, `GET /hybridflow-runner/options`,
`GET /hybridflow-runner/auth/status`, `POST /hybridflow-runner/auth/login/{start,code,cancel}`,
`GET|POST /hybridflow-runner/conversations`, `GET|PATCH|DELETE /hybridflow-runner/conversations/{id}`,
`POST /hybridflow-runner/conversations/{id}/fork`, `WS /ws/hybridflow-runner`. **Every one of them is also served under the
`/harnesses/…` and `/claude/…` compatibility aliases** — one handler, three names — and the socket answers
on `/ws/harness` and `/ws/claude` as well. HTTP compatibility and socket versioning are documented
in [PROTOCOL.md](/operation/worker/PROTOCOL.md).

The `/hybridflow-runner/conversations` family manages server-owned conversations and their turns.
See [Conversation registry](/operation/worker/docs/solution-design/conversations.md).

Other focused contracts:

| Contract | Responsibility |
| --- | --- |
| [Config documents](../../PROTOCOL/config-documents.md) | Dashboard configuration, UI state and runner identity. |
| [File actions](../../PROTOCOL/actions.md) | Provider-routed operations; see the [DCMS design](/docs/solution-design/partitions/dcms/file-actions.md). |
| [Media](../../PROTOCOL/media.md) | Video-segment saves and encoding jobs. |
| [The toolbox](../../PROTOCOL/toolbox.md) | Machine inventory, installation and turn equipment; see the [worker design](./toolbox.md). |

`GET /getFile` serves a regular file through `http.ServeContent`, so it answers `Range` and
`If-Modified-Since` and carries `Accept-Ranges`, `Content-Length` and `Last-Modified` — a download
over a mobile connection has a total to show progress against and a way to resume. It is sent
`no-cache`, because `Last-Modified` is the one thing a browser needs to invent a freshness lifetime
of its own, and a file edited under an open editor has to be re-read rather than remembered. A
directory path still streams a zip named after the folder.

Operational: `GET /healthz` — unauthenticated liveness probe,
returns `200 {"status":"ok"}`, registered outside the auth/trace chain so it is cheap and never
appears in the audit log. It is reachable in production via the existing `/api/files/healthz`
nginx proxy without extra configuration.

**[PROTOCOL.md](/operation/worker/PROTOCOL.md)** documents the full wire contract — every endpoint, and the
`/ws/hybridflow-runner` message protocol in both directions. The canonical TypeScript types for it live in
`reference/kiao-worker`.
