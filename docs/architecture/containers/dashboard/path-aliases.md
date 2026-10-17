# Path aliases (`tsconfig.paths.json`)

> Detail of [ARCHITECTURE.md](../../../../exchange/dashboard/ARCHITECTURE.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

| Alias | Resolves to |
| --- | --- |
| `@cms-core` | `src/cms-core/public-api.ts` — the framework façade, and the only way into it |
| `@cms-kit/markdown-editor` … `@cms-kit/diagram-shared` | one entry point per kit module (`markdown-editor`, `reorder`, `tts`, `markdown`, `template-lang`, `color`, `zoom-control`, `doc-id`, `components`, `template-fields`, `code-editor`, `capabilities`, `archdia`, `graph`, `diagram-shared`). Enumerated, never a wildcard: there is no `@cms-kit/*`, so a file inside a kit module cannot be reached |
| `@/*` | `src/*` |
| `react-advanced-interactions` / `…/*` | `src/cms-core/lib/react-advanced-interactions/…` (vendored) |
| `react-concise` / `react-concise/*` | `src/cms-core/lib/react-concise.tsx` (vendored `createSimpleContext` etc.) |

Aliases are honoured at build/dev time by `vite-tsconfig-paths` (see `vite.config.ts`) — which
applies them by looking at **who is importing**, so a source file outside `src/` resolves none of
them. A plugin project outside this one is exactly that, and gets the same names as plain Vite
aliases instead (`contractAliases` in `vite-plugins/assembly-shared.mjs`). `@/*` is deliberately
not among them.
