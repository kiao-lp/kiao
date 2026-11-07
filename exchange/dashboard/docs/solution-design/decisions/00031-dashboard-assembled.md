---
id: "00031"
title: "Dashboard is assembled, not compiled whole"
status: accepted
date: 2026-08-31
tags: ["dashboard", "plugins", "build"]
components: ["dashboard"]
paths: ["exchange/dashboard"]
symbols: ["scripts/build-assembly.mjs", "catalogue.json", "VITE_PLUGINS", "PluginAssemblyProvider", "@cms-kit/capabilities", "importmap"]
triggers: ["shared module", "import map", "tree-shaking", "capability", "plugin imports plugin", "@ant-design/icons"]
supersedes: ["00003"]
superseded_by: []
---

# 00031 — Dashboard is assembled, not compiled whole

**Decision:** `npm run build` builds each plugin to `build/plugins/<id>/` and the shell separately (`scripts/build-assembly.mjs`, `src/plugins/catalogue.json`, `VITE_PLUGINS`). The store selects loaded plugins in `.kiao-config/dashboard.json`. `PluginAssemblyProvider` imports them before the first render. The shell publishes shared modules — React, antd, router, OIDC context, files client, CodeMirror, mermaid, `@cms-core`, `@cms-kit/*` — at fixed URLs via an import map. Plugins build with those names external.

Separate builds let each store load a subset without source changes. The import map is the browser mechanism; no federation layer is needed. Single-instance modules are shared. Stateless modules bundle into their plugin, so an assembly without `pdf-view` downloads no pdfjs. Published modules are not tree-shaken and ship whole, so `@ant-design/icons` stays unshared. The dev server imports plugin source directly.

**Corollary:** plugins do not import each other. Shared code goes to `@cms-kit/<module>`. An optional feature is a capability: a named value pooled by cms-core, with name, type and absence behavior in `@cms-kit/capabilities`. Consumers behave the same when the feature is disabled or never assembled.

## Refactor notes

Supersedes the registration source of 00003: the hand-written list is store configuration.
