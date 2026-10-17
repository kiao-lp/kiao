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

**Decision:** `VITE_PLUGIN_PATHS` names **plugin project directories**, each a `package.json`
declaring a `kiaoPlugin` block and an `index.tsx`, whose entries are *added* to
`src/plugins/catalogue.json`. `cursus-view`, `cv-edit` and `lifesim-edit` left the lot for
`exchange/dashboard-plugins/` and are dropped back into the machine they were written for by
`bin/local-start-kiao.sh`. **Why:** the assembly made the plugin set a store's choice, but the
*repository* still delivered twenty-four plugins to everybody, three of which edit one person's own
affairs — a CV, a diploma path, a financial projection. Nothing about them is private; they are
simply of no use to a second reader, and the lot is better for not carrying them. A folder of this
monorepo rather than three repositories because the `@cms-core`/`@cms-kit` contract was sealed the
same week and a second checkout to keep in step buys nothing a folder does not; the variable takes
an absolute path either way, so that stays reversible.

**Corollary — the assembly owns the verification.** A dropped project carries source, tests and
fixtures and no way of running any of them: its unit tests run in the assembly's `npm test`, its
types in the assembly's `npm run build` (`tsc -p <dir>`), its `e2e/` as a Playwright project with
its fixtures seeded into the store. The assembly is the one place both halves of the contract exist
at once. Three consequences follow from a project sitting outside `src/`, and all three are answered
in `vite-plugins/assembly-shared.mjs`: tsconfig aliases do not apply to it (plain Vite aliases do),
the dev server will not serve it (`server.fs.allow`), and node resolution never reaches the
assembly's `node_modules` (lent as a maintained link, as npm does for a `file:` dependency). `@/…`
is deliberately not on the contract — reaching into `src/` is the attachment this exists to prevent.

**Corollary — which builds carry them is a list nobody writes twice.** The names went into
`bin/local-start-kiao.sh` alone, so the VPS and the installed `kiao` executable each shipped an
assembly without all three and nothing said so: a `.cv.json` opened as code, and the Configuration
panel offered no row to notice was missing. `bin/dashboard-plugin-projects.sh` prints the directory
as the `VITE_PLUGIN_PATHS` list instead, and the three builds of **this person's own instances**
call it — the local dev server, the VPS deploy, the installed executable. A build site cannot forget a
list it does not hold, and a fourth project is assembled by being put in the folder. The `kiao`
**image** deliberately does not call it: it is the copy handed to somebody else, and that is the
same reason the three left the lot.
