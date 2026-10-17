---
id: "00003"
title: "Dashboard plugin manifest (`CmsPlugin` + the plugin list)"
status: accepted
date: 2026-07-16
tags: ["dashboard", "plugins"]
components: ["dashboard"]
paths: ["exchange/dashboard/src"]
symbols: ["CmsPlugin", "PLUGINS", "fileConfigFor", "toolBars", "CreationProvider"]
triggers: ["new plugin", "register plugin", "file resolution", "toolbar tab", "first match wins"]
supersedes: []
superseded_by: ["00031"]
---

# 00003 — Dashboard plugin manifest (`CmsPlugin` + the plugin list)

**Decision:** each plugin exports a single `plugin: CmsPlugin` manifest (`id`, `fileConfigFor`,
optional `CreationProvider` / `lateralToolbars` / `markdownRenderers` — `lateralToolbars` since
renamed `toolBars`, see 2026-08-26); `App.tsx` derives file
resolution, creation-command wrappers and toolbar tabs from the one plugin list — a hand-written
`PLUGINS` array then, loaded from the store's configuration since 2026-08-31. **Why:**
before this, adding a plugin meant editing several hand-maintained lists in `App.tsx` that could
drift out of sync; the manifest makes registration a single ordered entry and makes the ordering
rule (first match wins; specific before generic) explicit and testable. The config-gated Claude
toolbar integration is a toolbar-only plugin, while Git (which owns the app-level diff mode) and
core file-template creation stay explicit in `App.tsx`.

## Refactor notes

Registration source moved to the store configuration (00031); `lateralToolbars` renamed `toolBars` (00016).
