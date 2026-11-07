---
id: "00032"
title: "a plugin need not be delivered to be assembled"
status: accepted
date: 2026-08-31
tags: ["dashboard", "plugins", "build"]
components: ["dashboard"]
paths: ["exchange/dashboard-plugins"]
symbols: ["VITE_PLUGIN_PATHS", "kiaoPlugin", "dashboard-plugin-projects.sh", "vite-plugins/assembly-shared.mjs"]
triggers: ["personal plugin", "cursus-view", "cv-edit", "lifesim-edit", "dropped project", "fixture seeding", "@/ alias"]
supersedes: []
superseded_by: []
---

# 00032 — a plugin need not be delivered to be assembled

**Decision:** `VITE_PLUGIN_PATHS` names plugin project directories. Each has a `package.json` with a `kiaoPlugin` block and an `index.tsx`. Entries merge into `src/plugins/catalogue.json`. Audience-specific plugins stay out of the base distribution.

**Assembly owns verification.** A project carries source, tests and fixtures. Its unit tests run in the assembly `npm test`, its types in `npm run build` (`tsc -p <dir>`), its `e2e/` as a Playwright project with fixtures seeded into the store. For projects outside `src/`, `vite-plugins/assembly-shared.mjs` supplies contract aliases, `server.fs.allow` and a `node_modules` link. `@/…` is excluded.

**Build sites derive the project list.** `bin/dashboard-plugin-projects.sh` prints the `VITE_PLUGIN_PATHS` list. Personal builds call it. The `kiao` image does not.
