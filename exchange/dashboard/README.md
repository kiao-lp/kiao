# Dashboard

Dashboard is the React/Vite web CMS that content providers use to author KIAO content. It is a
**file-oriented, plugin-based** single-page app: the backend
([`worker`](../../operation/worker/README.md)) exposes a managed file tree over
`/api/files`, and Dashboard renders and edits each file with the plugin that claims its file type
(markdown, units, mindmaps, CVs, PDFs, diagrams, …).

Its file-oriented views are the frontend half of **DCMS** — *document and content management
system* — the file and content management feature it forms together with the `files` service
inside that backend. Its boards and conversations views (the `hybridflow-ui` and `chat`
plugins) are the UI part of **hybridflow** instead. Both are functional names cutting across
containers, developed, delivered and deployed as one thing (the `kiao` Docker image,
`bin/local-start-kiao.sh`, the installed `kiao` executable). See
[`docs/solution-design/decisions/README.md`](../../docs/solution-design/decisions/README.md).

- **Solution design:** [`docs/solution-design/README.md`](./docs/solution-design/README.md) — the map (source zones,
  subsystems, plugins), each topic linking to its detail file.
- **Plugins:** the extension system is
  [`plugins-runtime.md`](docs/solution-design/plugins-runtime.md),
  [`plugins-assembly.md`](docs/solution-design/plugins-assembly.md) and
  [`plugins-rules.md`](docs/solution-design/plugins-rules.md);
  writing one is the `dashboard-plugin` skill
  ([`/.agents/skills/dashboard-plugin/SKILL.md`](../../.agents/skills/dashboard-plugin/SKILL.md),
  discovery entry in `.claude/skills/`).

## Running locally

The quickest path uses the local script from the repo root, which bypasses auth
(`VITE_NO_SECURITY=true`) and starts a `worker` for it to talk to:

```bash
./bin/local-start-kiao.sh
```

Or run Vite directly from this directory:

```bash
npm install
npm start          # dev server (Vite), served under /dashboard
npm run build      # assembly build (typecheck + shell + one build per plugin → build/)
npm test           # unit tests (Vitest, run once)
```

End-to-end tests (Playwright) live in [`../../e2e`](../../e2e) and drive the built app against a
live backend:

```bash
cd ../../e2e && npm test
```

## Access requirements

In a secured deployment (anything other than `VITE_NO_SECURITY=true`), users must:

1. **Account** — a valid account in the deployment's identity provider (Keycloak, the realm `VITE_OIDC_AUTHORITY` names).
2. **Authentication** — complete the OpenID Connect (OIDC) login flow. Dashboard is a public OIDC
   client (`client_id: dashboard`); access tokens obtained at login authorize every call to
   `worker`.
3. **Authorization** — the **`files_user`** role, required to reach the file store.
