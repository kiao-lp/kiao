---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# HTTP fallback

Read when `kiao-hybridflow` MCP is absent or its transport is unavailable. This reference defines
connection, authentication, HTTP request envelopes and the endpoint map. Shared behavior lives
in [operations](operations.md), [cards](cards.md), [chains](chains.md),
[structured data](structured-data.md), [classes](classes.md) and the targeted references linked
from the skill. Use the same semantics regardless of transport.

## Reaching the boards

For direct store access, the worker's environment can supply:

| Variable | Meaning |
|---|---|
| `KIAO_WORKER_HYBRIDFLOW_URL` | API base without a trailing slash, such as `https://example.com/api/hybridflow` or `http://127.0.0.1:18081`. |
| `KIAO_WORKER_HYBRIDFLOW_TOKEN` | Service credential accepted as a Bearer token. |

Worker-spawned turns inherit its environment, but check availability instead of assuming these
values exist. Do not print credentials. The following preamble fails explicitly if either is
missing; use the actual agent identity for the actor:

```bash
HYBRIDFLOW="${KIAO_WORKER_HYBRIDFLOW_URL:?no hybridflow-store address available}"
AUTH="Authorization: Bearer ${KIAO_WORKER_HYBRIDFLOW_TOKEN:?no service token available}"
ACTOR="X-Kiao-Actor: codex"

curl --fail-with-body -sS -H "$AUTH" "$HYBRIDFLOW/boards"
```

If this access is unavailable too, report what is missing. Missing variables do not prove that
no boards exist; they mean this route cannot reach them. A local file cannot replace the API.
An unconfigured worker proxy returns `503`; switching transport does not configure a backend.

Send `X-Kiao-Actor` on direct service-token writes, using the agent's own identity such as `codex`
or `claude`. Never impersonate the user. Without it, the log records `worker`. A Keycloak caller's
identity comes from its token and ignores the actor header. MCP instead uses the per-turn worker
token: the worker adds its service credential and records the turn owner as actor. MCP requires
no direct store address or service credential in its arguments.

## Requests and errors

Paths below are relative to `$HYBRIDFLOW`. `{handle}` accepts a board slug or id; ids come from
reads. Requests with a JSON body use `Content-Type: application/json`. Conditional writes use
`If-Match: <revision>` from the edited object. For example, after reading the actual id and revision:

```bash
curl --fail-with-body -sS -X PATCH "$HYBRIDFLOW/boards/major/flow-nodes/<card-id>" \
  -H "$AUTH" -H "$ACTOR" -H 'Content-Type: application/json' \
  -H 'If-Match: <revision>' -d '{"status":"ready"}'
```

Replace angle-bracket placeholders before calling. Use `--data-binary @request.json` for a body
prepared in a file, especially when it includes Markdown or literal interpolation placeholders.
A board read returns `board`, `flowNodes`, `flowNodeClasses`, `workflows`, `workflowClasses` and
`cursor`. Collection listings use the corresponding collection name, such as `boards` or `agents`.

| Status | Meaning and response |
|---|---|
| `201` | Created; read returned objects and minted ids. |
| `204` | Deleted successfully; no JSON body. |
| `400` | Malformed request or invalid domain configuration; inspect the error and repair it. |
| `401` | Missing or invalid credentials. |
| `404` | Object or board not found. Refresh discovery. |
| `409` | Revision conflict or object held by a run; read current state before deciding how to proceed. |
| `503` | Backend unavailable or unconfigured; inspect the reported reason. |

Errors return `{"error":"…"}`. A transport failure during a write can leave its result uncertain;
read the state before retrying. Never call the runner's `/play`, `/played` or `/settle` routes.
Starting and completing work uses the execution paths described in [chains](chains.md).

## Request envelopes

MCP tool schemas remain the contract for MCP arguments. Over HTTP, put handles and object ids
in the URL and revisions in `If-Match`; the body contains the resource change itself.
Optional fields below are supplied only when needed.

| Operation | HTTP body |
|---|---|
| Create board | `{"name":"Major"}` |
| Patch board | Changed `name` and/or `archive` fields. |
| Create cards | `{"flowNodes":[<card>, ...]}` with fields from [cards](cards.md). |
| Patch card | Changed card fields directly, with no `patch` wrapper. |
| Delete cards | `{"flowNodes":["<id>", ...]}` |
| Chain card or class | `{"flowNode":"<target-id>"}`; empty target unlinks. |
| Convert task to class | `{}` |
| Create class | Class fields and optional first-version fields from [classes](classes.md). |
| Patch class or version | Changed fields directly, with no `patch` wrapper. |
| Delete classes | `{"flowNodeClasses":["<id>", ...]}` |
| Create version | Version fields and/or `from` version id; `{}` creates a blank draft. |
| Instantiate class or workflow class | Optional `spot` and `bodies`; `{}` uses defaults. |
| Create workflow ([group rules](reuse/workflows.md)) | `{"name":"Release","flowNodes":["<id>", ...]}`; both fields optional. |
| Create workflow class ([group rules](reuse/workflows.md)) | `{"name":"Release","classes":["<id>", ...]}`; both fields optional. |
| Rename workflow, workflow class or runner | `{"name":"New name"}` |
| Delete workflows | `{"workflows":["<id>", ...]}` |
| Delete workflow classes | `{"workflowClasses":["<id>", ...]}` |
| Create or patch agent | Supplied [agent fields](execution/agents.md), without a wrapper. |
| Publish agent | No body; include `If-Match` when based on a read. |
| Create runner | `{"name":"local"}` |

## Endpoint map

The corresponding worker proxy adds `/hybridflow-runner` before each path. MCP uses that proxy.
Direct store calls use the paths shown here.

| MCP tool | HTTP call |
|---|---|
| `board_list` | `GET /boards`; `?archived=1` includes archives |
| `board_create` | `POST /boards` |
| `board_get` | `GET /boards/{handle}` |
| `board_patch` | `PATCH /boards/{handle}` |
| `board_delete` | `DELETE /boards/{handle}` |
| `board_add_cards` | `POST /boards/{handle}/flow-nodes` |
| `board_get_card` | `GET /boards/{handle}/flow-nodes/{id}` |
| `board_patch_card` | `PATCH /boards/{handle}/flow-nodes/{id}` |
| `board_delete_cards` | `DELETE /boards/{handle}/flow-nodes` |
| `board_chain_card` | `POST /boards/{handle}/flow-nodes/{id}/chain` |
| `board_card_usage` | `GET /boards/{handle}/flow-nodes/{id}/usage` |
| `board_card_to_class` | `POST /boards/{handle}/flow-nodes/{id}/to-class` |
| `board_schema_values` | `GET /schema-values` |
| `class_list` | `GET /flow-node-classes` |
| `class_create` | `POST /boards/{handle}/flow-node-classes` |
| `class_get` | `GET /boards/{handle}/flow-node-classes/{id}` |
| `class_patch` | `PATCH /boards/{handle}/flow-node-classes/{id}` |
| `class_delete` | `DELETE /boards/{handle}/flow-node-classes` |
| `class_chain` | `POST /boards/{handle}/flow-node-classes/{id}/chain` |
| `class_create_version` | `POST /boards/{handle}/flow-node-classes/{id}/versions` |
| `class_patch_version` | `PATCH /boards/{handle}/flow-node-classes/{id}/versions/{versionId}` |
| `class_delete_version` | `DELETE /boards/{handle}/flow-node-classes/{id}/versions/{versionId}` |
| `class_instantiate` | `POST /boards/{handle}/flow-node-classes/{id}/instantiate` |
| `workflow_create` | `POST /boards/{handle}/workflows` |
| `workflow_get` | `GET /boards/{handle}/workflows/{id}` |
| `workflow_patch` | `PATCH /boards/{handle}/workflows/{id}` |
| `workflow_delete` | `DELETE /boards/{handle}/workflows` |
| `workflow_class_list` | `GET /workflow-classes` |
| `workflow_class_create` | `POST /boards/{handle}/workflow-classes` |
| `workflow_class_get` | `GET /boards/{handle}/workflow-classes/{id}` |
| `workflow_class_patch` | `PATCH /boards/{handle}/workflow-classes/{id}` |
| `workflow_class_delete` | `DELETE /boards/{handle}/workflow-classes` |
| `workflow_class_instantiate` | `POST /boards/{handle}/workflow-classes/{id}/instantiate` |
| `agent_list` | `GET /agents`; `?archived=true` includes archives |
| `agent_create` | `POST /agents` |
| `agent_get` | `GET /agents/{id}` |
| `agent_patch` | `PATCH /agents/{id}` |
| `agent_publish` | `POST /agents/{id}/publish` |
| `agent_versions` | `GET /agents/{id}/versions` |
| `agent_delete` | `DELETE /agents/{id}`; unpublished agents only |
| `runner_list` | `GET /runners` |
| `runner_create` | `POST /runners` |
| `runner_get` | `GET /runners/{id}` |
| `runner_patch` | `PATCH /runners/{id}` |
| `runner_delete` | `DELETE /runners/{id}` |
| `board_changes` | `GET /changes?since=&board=&limit=` |
| `hybridflow_schema` | `GET /schema` |

Single-object deletes carry the id in the URL and no body. Collection deletes carry the
id list in the body. Direct store HTTP additionally resolves `GET /schema-values/{id}`.

## Watching over HTTP

Read the board, keep its cursor, and request changes from that point:

```bash
curl --fail-with-body -sS -H "$AUTH" \
  "$HYBRIDFLOW/changes?since=$cursor&board=$board_id&wait=1"
```

`board` is the board **id**, not its slug. `wait=1` holds for a change or approximately 25 seconds;
without it the request returns immediately. `limit` caps the page, and `more` asks the caller to
fetch another page from the returned cursor. MCP's `board_changes` always returns immediately.
Event fields and when observation is useful are described in [observation](operations/observation.md).
