---
status: DRAFT
role: PRIMARY_SOURCE
---

# Path aliases (`tsconfig.paths.json`)

Part of the [Dashboard solution design](README.md).

[tsconfig.paths.json](../../tsconfig.paths.json) owns the complete alias list.

| Alias | Target and constraint |
| --- | --- |
| `@cms-core` | Framework facade, `src/cms-core/public-api.ts` |
| `@cms-kit/<module>` | Explicit kit entry points; no wildcard or access to internals |
| `@/*` | Shell source under `src/*`; not available to external plugins |
| `react-advanced-interactions` / subpaths | Shared pointing helpers under `src/cms-core/ui-foundation/interactions/` |
| `react-concise` / subpaths | Context helpers in `src/cms-core/ui-foundation/react/contexts.tsx` |

The existing `@cms-kit/components`, `@cms-kit/code-editor`, `@cms-kit/reorder` and
`@cms-kit/zoom-control` aliases target the [UI foundation](../../src/cms-core/ui-foundation/README.md).
They preserve plugin contracts without duplicate implementations or forwarding folders in the kit.

`vite-tsconfig-paths` applies aliases according to importer scope. External plugin projects
instead receive explicit Vite `contractAliases` from
[assembly-shared.mjs](../../vite-plugins/assembly-shared.mjs), excluding `@/*`.
See [import rules](plugins-rules.md) and [external project assembly](plugins-assembly.md).
