---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Dashboard

Dashboard is kiao's React/Vite frontend. Its file views form **DCMS** with the
[`worker`](../../operation/worker/README.md) files service at `/api/files`.
The `hybridflow-ui` and `chat` plugins provide the boards and conversations UI for
**hybridflow**. Plugins select the editor or viewer for each document.

| Task | Start here |
| --- | --- |
| Locate code or understand behavior | [Solution design](docs/solution-design/README.md) |
| Add or change a plugin | [Plugin guide](src/plugins/README.md) |
| Write a React unit test | [Test helpers](src/test/README.md) |
| Build, run or verify kiao | [Repository guide](../../AGENTS.md) |

Keep a component's design in its `docs/solution-design/` under `src/core/`, `src/kit/`
or `src/plugins/`. Choose the primary owner of the behavior, including its integration
with callers and dependencies. Shared conventions, application assembly and designs with
several owners live in Dashboard's `docs/solution-design/`; decisions stay centralized in
`docs/solution-design/decisions/`.
Usage/API details stay beside their plugin or kit module. Update the owning index when
adding a page.

## Running locally

From the repository root, start Dashboard and worker without authentication
(`VITE_NO_SECURITY=true`):

```bash
./bin/local-start-kiao.sh
```

To run Vite separately, build the reference libraries first
(`./bin/build-reference.sh` from the repository root) and provide a running worker.
From this directory:

```bash
npm install
npm start          # Vite, served under /dashboard
npm run build      # typecheck, plugin builds and shell → build/
npx vitest run src/core/extensibility/plugin-resolution.test.tsx  # use the affected test path
```

Run a relevant Playwright spec against the throwaway stack through the e2e runner:

```bash
cd ../../e2e
bin/run-tests.sh tests/dashboard/plugin-smoke.spec.ts
```

## Access requirements

A secured deployment requires an account in the identity provider named by
`VITE_OIDC_AUTHORITY`, an OIDC login through the public `dashboard` client, and the
`files_user` role. Access tokens authorize worker requests; see
[backend access](src/core/auth/docs/solution-design/backend-access.md).
