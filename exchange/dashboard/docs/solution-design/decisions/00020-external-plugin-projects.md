---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-08-31
tags: ["dashboard", "plugins", "build"]
triggers: ["external plugin", "dropped project", "fixture seeding", "@/ alias", "VITE_PLUGIN_PATHS", "kiaoPlugin", "dashboard-plugin-projects.sh", "vite-plugins/assembly-shared.mjs"]
supersedes: []
superseded_by: []
---

# 00020 — External plugin projects join build via VITE_PLUGIN_PATHS.

## Context and Problem Statement

Assemblies need audience-specific plugins while the base remains self-contained.
External projects need the same manifest contract and verification as delivered plugins.

## Considered Options

* Supply plugin project directories through `VITE_PLUGIN_PATHS`.

Other considered options were not recorded.

## Decision Outcome

Chosen option: "Supply plugin project directories through `VITE_PLUGIN_PATHS`", because
assemblies can add their own projects without making them base dependencies.

Each directory has an `index.tsx` and a `package.json` carrying `kiaoPlugin`.
Its entry merges into `src/plugins/catalogue.json`. The invoking assembly supplies the list;
the base neither discovers nor names external projects, and its default image carries
only the base catalogue.

### Confirmation

Projects own their source, tests and fixtures; assemblies run them. `npm test` runs unit
tests, `npm run build` type-checks through `tsc -p <dir>`, and `e2e/` runs as a
Playwright project with seeded fixtures. For projects outside `src/`,
`vite-plugins/assembly-shared.mjs` supplies contract aliases, `server.fs.allow` and a
`node_modules` link; `@/…` is excluded.
