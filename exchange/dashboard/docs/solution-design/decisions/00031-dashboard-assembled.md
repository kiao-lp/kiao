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

**Decision:** the plugin set is decided twice and neither decision is in the source. `npm run build`
builds each plugin into `build/plugins/<id>/` as its own ES module and the shell separately
(`scripts/build-assembly.mjs`, `src/plugins/catalogue.json`, `VITE_PLUGINS`); the store names the
plugins it loads in `.kiao-config/dashboard.json`, and `PluginAssemblyProvider` imports them before
the first render. The shell publishes the shared surface — react, antd, the router, the OIDC
context, the files client, CodeMirror, mermaid, `@cms-core`, every `@cms-kit/*` — at fixed URLs and
declares it in an `<script type="importmap">`; each plugin is built with those names external.
**Why:** a plugin was being delivered to everybody, and the only way to stop that without moving
code out of this repository is to build the pieces separately and choose between them at load time.
The import map rather than Module Federation because it is the browser's own mechanism and Vite 6
needs nothing added to use it. What must be one instance is on the shared list; what is stateless is
bundled into the plugin that wants it, so a store assembled without `pdf-view` downloads no pdfjs.
The cost, stated because it is not obvious: a published module cannot be tree-shaken, so anything on
the list ships whole — which is why `@ant-design/icons` is deliberately *not* on it. The three
runtimes are untouched: they still serve a directory. The dev server is the one divergence, and it
is confined to where a plugin's module comes from.

**Corollary — a plugin may not import another.** A plugin the assembly did not load has no module to
import. Two answers, chosen by asking whether the consumer still works with the provider absent:
shared *code* goes to the kit (`@cms-kit/template-fields` was extracted this way), and a shared
*feature* is published as a **capability** — a value under a name in the manifest, pooled app-wide
by cms-core, with the names, their types and their absent-behaviour declared in
`@cms-kit/capabilities`. The tasks board's eleven imports into `claude`, `tags` and `template-edit`
became four capabilities and one kit module, and the board now degrades the same way whether the
feature is switched off or the plugin was never assembled.

## Refactor notes

Supersedes the registration source of 00003 (hand-written list becomes store configuration).
