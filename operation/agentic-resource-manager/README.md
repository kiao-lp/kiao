---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# agentic-resource-manager

This Go service owns **agent Git working trees**, **APM publication** and **prepared package
delivery** to workers. Read the [solution design](../../docs/solution-design/agentic-resources.md)
for lifecycle, storage paths, environment overrides and execution binding; the
[conceptual DFD](../../docs/architecture/data/agentic-resources.md) describes the information flows.

```sh
KIAO_AGENTIC_RESOURCE_MANAGER_AUTH_MODE=debug \
KIAO_AGENTIC_RESOURCES_PATH=/tmp/my-agents go run .
```

**Prerequisites**: Git, Python 3.11+ and `apm-cli==0.35.1`. `build.sh` produces a static
linux/amd64 binary; `go test ./...` checks the service lifecycle and adapters.

## Configuration

**Storage configuration** is centralized in the design's inventory:
`KIAO_AGENTIC_RESOURCES_PATH`, `KIAO_AGENTIC_DEPENDENCIES_PATH`,
`KIAO_AGENTIC_RESOURCE_MANAGER_CACHE` and APM's own cache settings.

| Variable | Purpose |
| --- | --- |
| `KIAO_AGENTIC_RESOURCE_MANAGER_PORT` | HTTP port; default `18082`. |
| `KIAO_AGENTIC_RESOURCE_MANAGER_BIND` | Listen address; empty binds all interfaces. |
| `KIAO_APM_BINARY` | APM executable; default `apm`. |
| `KIAO_AGENTIC_RESOURCE_MANAGER_AUTH_MODE` | `prod` by default; `debug` for local verification. |
| `KIAO_KEYCLOAK_ISSUER_URI`, `KIAO_KEYCLOAK_JWK_SET_URI` | Required in prod; human JWTs require `files_user`. |
| `KIAO_AGENTIC_RESOURCE_MANAGER_SERVICE_TOKEN` | Optional technical bearer for consumers and server proxies. |
| `KIAO_AGENTIC_RESOURCE_MANAGER_CORS_ORIGINS` | Comma-separated browser origins. |

**Service consumers** use `KIAO_AGENTIC_RESOURCE_MANAGER_URL` and the service token. Dashboard
defaults to same-origin `/api/agentic`; `VITE_AGENTIC_RESOURCE_MANAGER_BASE_URL` overrides its
browser endpoint. The installed `kiao` command uses the shared server for source management and
keeps prepared execution packages locally.

## HTTP contract

`GET /healthz` is public. Other routes require authentication in prod.

| Route | Operation |
| --- | --- |
| `GET /agents` | Discover agent working trees, including manual clones. |
| `POST /agents` | Import or initialize an agent at `repository` (Git URL or server-local path), or create a local draft with `name` and `harness`. |
| `GET,PATCH /agents/{id}` | Read/edit identity and native instructions. PATCH supports `If-Match`. |
| `GET /agents/{id}/skills` | List skill repositories and draft links with `name`, `available`, `linked`, `hasRemote` and `local`. |
| `GET /agents/{id}/mcp` | List MCP repositories and draft links with the same fields as skills. |
| `PUT,DELETE /agents/{id}/{skills,mcp}/{name}` | Link or unlink the repository. PUT accepts `{"local":true}` to use its working tree for draft conversations. An empty PUT or `{"local":false}` selects the Git remote when configured. |
| `POST /agents/{id}/publish` | Bump the agent version, resolve and compile the package, commit and tag the release, and push if a remote exists. |
| `GET /agents/{id}/versions` | Publications, oldest first. |
| `GET /agents/{id}/packages/{commit}` | Prepared deployment of a published full Git commit. |
| `POST /agents/{id}/packages/draft` | Snapshot the agent and prepare its working-tree deployment. Returns `agent` and `package` with the same `draftId`. |
| `GET /agents/{id}/deletion` | Deletion warnings and current-state confirmation fingerprint. |
| `DELETE /agents/{id}?confirmation=…` | Delete the clone after confirming its current state. |
| `GET /agentic-resources` | Editable APM projects, their versions and Git state. |
| `GET,PUT /agentic-resources/{name}/file?path=…` | Read/write sources. PUT: `{path, content, revision?}`. |
| `POST /agentic-resources/{name}/{operation}` | `install`, `publish`, `pull`, `push`; publish agents through their agent endpoint. |

Initializing a supplied repository commits and pushes an unpublished draft. The request may set
its draft fields. The repository name and Claude are the defaults for `name` and `harness`.
An existing agent supplies its own identity and settings on import. Send `importOnly: true`
to require an existing agent.

Both publication endpoints accept `{"bump":"major"}`, `{"bump":"minor"}` or `{"bump":"patch"}`.
The default is patch. The API returns the version as a string such as `"1.2.3"` and the Git
release tag as `"v1.2.3"`. Catalogue entries include the version used as the base for the next bump.

Publication refuses active temporary local overrides. A push with local resource dependencies
returns `409` with `pushConfirmation.dependencies` and `pushConfirmation.token`. After confirmation,
repeat the operation with the same bump and include `"confirmation":"<token>"`. The resource's
**Git push** operation uses the same confirmation exchange.

**Package format**: `format: "apm-deployment-v1"`, `project: "deployment"`, published `commit`
and `files`, a base64 byte map rooted at `deployment/`. Files include the committed APM lock,
projected skills, MCP configuration and installed dependencies; `.git` metadata is excluded.
Package preparation is lazy and cached by agent and commit.

## Components

| Directory | Responsibility |
| --- | --- |
| `core/` | Agent/resource lifecycle and contracts. |
| `adapters/filesystem/` | Repository discovery, source editing, releases and package assembly. |
| `adapters/gitcli/`, `adapters/apm/` | Bounded Git and APM commands. |
| `adapters/cache/` | Persistent publication packages. |
| `adapters/httpapi/`, `adapters/auth/` | Resource API, JWT and technical bearer authentication. |
| `main.go` | Configuration, assembly and process lifecycle. |
