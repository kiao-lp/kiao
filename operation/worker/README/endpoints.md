# Endpoints

← [worker](/operation/worker/README.md) · assumes the index (contract, auth).

File store: `GET /getFile`, `POST /upload`, `PUT /update`, `DELETE /delete`, `POST /deleteBatch`, `GET /list`,
`GET /listRecursive`, `GET /info`, `POST /createFolder`, `POST /rename`, `POST /moveBatch`, `POST /copyBatch`, `GET /search`,
`GET /diskUsage`, `GET /storeInfo`.

Documents (not part of the Java parity surface): `POST /reindex`.

Store hygiene (not part of the Java parity surface): `GET /fileOptimizations`, `POST /deduplicate`.

`POST /copyBatch` is the only other one outside the Java parity surface: it copies whole entries —
a file with its subsidiaries, or a directory with everything under it — server-side, so a client
never walks a tree file by file.

`POST /reindex` converts the documents at or under the given paths into their sibling index —
Markdown for a document, CSV for a workbook — which is the same conversion `/search` performs on
its own for anything missing or out of date. Asking for it is what covers the two cases search
does not: doing a whole folder now rather than on the next search, and rewriting an index that is
current but in a format an older version of this service wrote. Neither ever overwrites an index a
person wrote. It is the endpoint behind Dashboard's *Rebuild search index* context-menu command.

Git (Source Control panel): `GET /git/status`,
`POST /git/{fetch,stage,unstage,stageBatch,unstageBatch,revert,commit,push,pull,consolidate,save}`,
`GET /git/{original,working}`.

Hybridflow-runner (not part of the Java parity surface): `GET /hybridflow-runner/usage`, `GET /hybridflow-runner/options`,
`GET /hybridflow-runner/auth/status`, `POST /hybridflow-runner/auth/login/{start,code,cancel}`,
`GET|POST /hybridflow-runner/conversations`, `GET|PATCH|DELETE /hybridflow-runner/conversations/{id}`,
`POST /hybridflow-runner/conversations/{id}/fork`, `WS /ws/hybridflow-runner`. **Every one of them is also served under the
`/agents/…` and `/claude/…` names it had before** — one handler, three names — and the socket answers
on `/ws/agent` and `/ws/claude` as well; see [PROTOCOL.md](/operation/worker/PROTOCOL.md) for why the two surfaces answered the renames differently.

The `/hybridflow-runner/conversations` family is what turned the agent panel from a browser-side buffer into a
server-owned feature: the conversations an agent process runs turns in. See [Conversation registry](/operation/worker/README/conversations.md).

Config documents (not part of the Java parity surface): `GET|PUT /config/{name}` — the two
documents Dashboard keeps outside its content, served from the state directory rather than the file
store. See [Config documents](/operation/worker/README/request-handling.md).

File actions (not part of the Java parity surface): `GET /actions`, `POST /actions/run` — see [File actions](/operation/worker/README/actions-toolbox.md).

Media (not part of the Java parity surface): `POST /media/saveSegments`,
`GET|DELETE /media/jobs/{id}` — a video's segments saved as files of their own, AV1 and Opus in
Matroska, by the toolbox's ffmpeg; `424` where the machine has none able to do it. See [Media](/operation/worker/PROTOCOL/actions-media-toolbox.md).

Toolbox (not part of the Java parity surface): `GET /toolbox`,
`POST /toolbox/{install,uninstall,registration}`, `GET /toolbox/jobs/{id}` — the configuration
panel: what this service can install on the machine it runs on, and which MCP servers a turn is
handed. Every call names ids from the toolbox catalogue (`pub.json` plus the deployment's own
files); there is no command, no package name and no version on the wire. See [The toolbox](/operation/worker/README/actions-toolbox.md).

`GET /getFile` serves a regular file through `http.ServeContent`, so it answers `Range` and
`If-Modified-Since` and carries `Accept-Ranges`, `Content-Length` and `Last-Modified` — a download
over a mobile connection has a total to show progress against and a way to resume. It is sent
`no-cache`, because `Last-Modified` is the one thing a browser needs to invent a freshness lifetime
of its own, and a file edited under an open editor has to be re-read rather than remembered. A
directory path still streams a zip named after the folder.

Operational (not part of the Java parity surface): `GET /healthz` — unauthenticated liveness probe,
returns `200 {"status":"ok"}`, registered outside the auth/trace chain so it is cheap and never
appears in the audit log. It is reachable in production via the existing `/api/files/healthz`
nginx proxy without extra configuration.

**[PROTOCOL.md](/operation/worker/PROTOCOL.md)** documents the full wire contract — every endpoint, and the
`/ws/hybridflow-runner` message protocol in both directions. The canonical TypeScript types for it live in
`reference/npm/kiao-worker`.
