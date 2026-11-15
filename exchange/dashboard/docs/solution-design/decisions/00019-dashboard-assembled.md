---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-08-31
tags: ["dashboard", "plugins", "build"]
triggers: ["shared module", "import map", "tree-shaking", "capability", "plugin imports plugin", "@ant-design/icons", "new plugin", "register plugin", "file resolution", "toolbar tab", "first match wins", "scripts/build-assembly.mjs", "catalogue.json", "VITE_PLUGINS", "PluginAssemblyProvider", "@kiao-dashboard-kit/capabilities", "importmap"]
supersedes: []
superseded_by: []
---

# 00019 — Dashboard builds shell and plugins as separate modules.

## Context and Problem Statement

Stores need to load different plugin subsets without source changes. Modules with shared
state must remain single instances across shell and plugin builds.

## Considered Options

* Build the shell and plugins separately and share modules through an import map.
* Add a federation layer.

## Decision Outcome

Chosen option: "Build the shell and plugins separately and share modules through an import map",
because the browser provides module sharing without a federation layer.

`npm run build` uses `scripts/build-assembly.mjs`, `src/plugins/catalogue.json` and
`VITE_PLUGINS` to build the shell and `build/plugins/<id>/` separately. Stores select
loaded plugins in `.kiao-config/dashboard.json`; `PluginAssemblyProvider` imports them
before first render.

The shell publishes fixed import-map URLs for React, antd, router, OIDC context, files
client, CodeMirror, Mermaid, `@kiao-dashboard-core` and `@kiao-dashboard-kit/*`.
Plugins externalize these names. Stateless dependencies bundle with their plugin, so
omitting `pdf-view` avoids downloading pdfjs. Published modules ship whole without
tree-shaking, so `@ant-design/icons` remains unshared. The dev server imports plugin source.

Plugins do not import one another. Shared widgets belong in `@kiao-dashboard-kit/<module>`.
Optional features publish capabilities through core, with name, type and absence behavior
in `@kiao-dashboard-kit/capabilities`; disabled and unassembled features behave alike.

Each plugin exports one `DashboardPlugin` manifest. Core derives file resolution, creation
and toolbar contributions, including toolbar-only plugins. The recorded matching order
places specific claims before generic ones so the first match wins.
