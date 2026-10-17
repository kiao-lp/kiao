# Backend access

> Detail of [ARCHITECTURE.md](../../../../exchange/dashboard/ARCHITECTURE.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

- **`kiao-worker`** ([`reference/npm/kiao-worker/src/`](../../../../reference/npm/kiao-worker/src)) is the
  typed client, consumed via the `file:` protocol. It exports:
  - **`WorkerClient`** (`client.ts`) — file CRUD (`listFiles`, `getFileText`/`getFileBlob`/`getFileResponse`,
    `getFileMetadata`, `createFolder`, `delete`, `rename`, `update`, `upload`, `download`,
    `getDownloadUrl`, `getDiskUsage`, JSON helpers) and git (`gitStatus`, `gitFetch`, `gitStage`,
    `gitUnstage`, `gitStageBatch`, `gitUnstageBatch`, `gitRevert`, `gitCommit`, `gitPush`, `gitPull`,
    `gitConsolidate`, `gitOriginal`, `gitWorking`, `gitSave`), plus `WorkerError`. The Git panel stages through
    the batch pair only — one request and one git command per action, whatever the file count.
  - **types** (`types.ts`) — `FileDto`, `FileCompanion`, `DiskUsage`, `SearchResult`, `Document<T>`,
    `GitFile`, `GitStatus`, `GitResult`.
  - **Agent wire types** (`agent-types.ts`) — the single source of truth for the `/hybridflow-runner/usage`
    and `/ws/hybridflow-runner` contract: `AgentUsage` / `AgentUsageWindow`, and the socket message unions
    `AgentClientMessage` (subscribe / unsubscribe / prompt / between / stop / permission_decision /
    question_answer) and
    `AgentServerMessage` (start / session / output / tool_use / subagent / background / between /
    notice / done / error / stopped / sync / permission_request / question_request /
    permission_resolved / not_running / conversation / conversation_deleted), plus
    `AgentWireBlock` (the ordered `text` / `thinking` / `tool_use` pieces a reply is made of),
    `AgentWireToolUse`, `AgentWirePermissionRequest`, `AgentWireQuestionRequest` (with
    `AgentWireQuestion` / `AgentWireQuestionOption`), `AgentPermissionMode` and
    `AgentPermissionOutcome`.
    Field names are the wire — the Go side is documented in `worker`'s `PROTOCOL.md`.
  - **hooks** (`hooks.ts`) — `useCreateWorkerClient`, `useFiles`, `useFileContent`.
  - **context** (`context.tsx`) — `WorkerClientProvider`, `useWorkerClient`, `WorkerClientMockProvider`
    (used by tests).
- **Wiring** ([`App.tsx`](../../../../exchange/dashboard/src/App.tsx)). A single `createWorkerClient(getToken?)` helper builds the
  client against `/api/files` (relative to the page origin); it is mounted via
  `cms-core/files/service/ui`'s `WorkerClientProvider`.
  - **Secured path** (`AuthenticatedApp`): `react-oidc-context` `AuthProvider` with the OIDC
    authority from `VITE_OIDC_AUTHORITY` (default `http://localhost:8080/realms/kiao`),
    `client_id: "dashboard"`. It passes
    a token provider, so `createWorkerClient` wires `customFetch` and the metadata header hook to
    inject `Authorization: Bearer <access_token>` (read live from the current OIDC user);
    silent-renew / token-expiry / auth-error all redirect to login preserving the return path.
  - **No-security path** (`NoSecurityApp`): when `import.meta.env.VITE_NO_SECURITY === 'true'`, auth
    is bypassed entirely and `createWorkerClient()` is called with no token provider, so the client is
    created without headers. This is what `bin/local-start-kiao.sh`, the Docker image
    (`bin/build-kiao-image.sh`), the packaged executable and the e2e harness use.
- **Reading the token** ([`cms-core/auth/authToken.ts`](../../../../exchange/dashboard/src/cms-core/auth/authToken.ts)). The one
  place the OIDC session is read from outside `App.tsx`: `securityEnabled` (the build flag) and
  `useAuthToken()`, which viewers that must send an `Authorization` header take their token from,
  and `useAuthenticatedFileUrl` its `access_token` query parameter for the `<img>`/`<a>` that
  cannot send one. It reads react-oidc-context's plain `AuthContext` rather than its `useAuth()`
  hook **on purpose**: with no provider mounted `useAuth()` warns to the console on every render,
  which in a no-security run is every render of every such viewer. A missing provider is a
  legitimate state here, answered with `undefined` — as is security being off, and the user not
  being authenticated yet. No plugin imports `react-oidc-context` itself.
