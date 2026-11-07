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

**Decision:** each plugin exports one `plugin: CmsPlugin` manifest (`id`, `fileConfigFor`, optional `CreationProvider` / `toolBars` / `markdownRenderers`). `App.tsx` derives file resolution, creation wrappers and toolbar tabs from the plugin list. The list comes from store configuration. Registration is one ordered entry. Resolution is first match wins, specific claims before generic. Git and core file-template creation stay explicit in `App.tsx`. The chat toolbar integration is a toolbar-only plugin.
