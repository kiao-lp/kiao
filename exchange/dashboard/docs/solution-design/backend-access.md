---
status: DRAFT
role: PRIMARY_SOURCE
---

# Backend access

Part of the [Dashboard solution design](README.md).

## Typed client

[`kiao-worker`](../../../../reference/kiao-worker/src/) is the shared client, consumed via `file:` dependencies. API inventories and wire unions stay in source.

| Source | Contract |
| --- | --- |
| [client.ts](../../../../reference/kiao-worker/src/client.ts) | `WorkerClient`, file/config/Git operations and `WorkerError` |
| [types.ts](../../../../reference/kiao-worker/src/types.ts) | File, search, document and Git DTOs |
| [agent-types.ts](../../../../reference/kiao-worker/src/agent-types.ts) | Usage, ordered reply blocks, permissions, questions and socket message unions |
| [hooks.ts](../../../../reference/kiao-worker/src/hooks.ts) / [context.tsx](../../../../reference/kiao-worker/src/context.tsx) | React hooks and client providers |
| [worker protocol](../../../../operation/worker/PROTOCOL.md) | Server endpoints and wire semantics |

The Git panel uses batch stage/unstage calls: one HTTP request and Git command per action,
independent of selected file count. Socket handlers switch exhaustively over the shared server
union so new message types require explicit handling.

## Application wiring and renewal

[App.tsx](../../src/App.tsx) creates one client for origin-relative `/api/files` and mounts it
through `cms-core/files/service/ui`'s provider.

- **Secured:** OIDC authority comes from `VITE_OIDC_AUTHORITY`, with a loopback fallback, and
  client ID `dashboard`. Fetch and metadata headers read the current bearer token from a ref.
- **No security:** `VITE_NO_SECURITY === 'true'` skips `AuthProvider` and creates a client without
  token headers. Local scripts, packaged kiao and the e2e harness use this path.

[Session recovery](../../src/cms-core/auth/sessionRecovery.ts) tries silent renewal, then hidden
iframe authentication, then accepts a still-valid current token. Only exhausted recovery causes
a login redirect, preserving the return path. Ordinary renewals leave `DashboardApp` mounted.

Before `/actions/run`, refresh a token with less than **240 seconds** remaining. Shared renewal
prevents racing single-use refresh grants. Update the token ref before sending the action because
OIDC renewal can resolve before React rerenders. This cannot protect a job that outlives the token.
Routine requests do not trigger this preflight.

## Reading a token in a viewer

Use [useAuthToken](../../src/cms-core/auth/authToken.ts) through `@cms-core`; plugins must not
import `react-oidc-context` directly. It reads plain `AuthContext` so an absent provider in a
no-security run returns `undefined` without repeated `useAuth()` warnings.
`useAuthenticatedFileUrl` supplies an `access_token` query parameter for image or link elements
that cannot send an Authorization header.
