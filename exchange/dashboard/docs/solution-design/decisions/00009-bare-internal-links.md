---
id: "00009"
title: "an internal link is stored bare and resolved on display"
status: accepted
date: 2026-08-15
tags: ["links", "routing", "dashboard"]
components: ["dashboard"]
paths: []
symbols: ["VITE_BASE_PATH", "BASE_URL", "InternalLinkNavigator", "resolveLink", "LinkFixer", "V017"]
triggers: ["internal link", "basename", "context path", "copied URL", "/dashboard prefix", "router navigation"]
supersedes: []
superseded_by: []
---

# 00009 — an internal link is stored bare and resolved on display

**Decision:** internal links are stored as store-root-relative paths with a leading slash (`/units/abc/cadre.md`) and resolve to hrefs on display against `import.meta.env.BASE_URL`. `App.tsx` derives the router basename and OIDC redirect from the same value. The mount is a build setting (`VITE_BASE_PATH`, default `/dashboard/`). `navigation/internal-links.ts` holds the helpers; `InternalLinkNavigator` routes internal anchor clicks.

Bare paths survive domain and mount changes and match `LinkFixer` tokens. Resolution is idempotent, so links containing the mount prefix still display. New writes use bare store links.
