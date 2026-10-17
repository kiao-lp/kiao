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

**Decision:** a link from one document to another is stored as a store-root-relative path with a
leading slash (`/units/abc/cadre.md`) and turned into a href only when it is displayed, against
`import.meta.env.BASE_URL`; `App.tsx` derives the router basename and the OIDC redirect from that
same value, and the context path becomes a build setting (`VITE_BASE_PATH`). `lib/internal-links.ts`
holds the three functions, one click listener (`InternalLinkNavigator`) turns any internal anchor
into a router navigation, and markdown-renderer gained a `resolveLink` prop beside its `resolveImage`
one. **Why:** the shape written before this — `/dashboard/mon/chemin`, or the whole
`https://kiao-lp.app/dashboard/mon/chemin` when copied from the address bar — put the deployment
inside the content, so a new domain or a new mount point would have invalidated every link ever
authored. It also defeated the one repair mechanism there is: `LinkFixer` matches a path token
preceded by a boundary, and the `/` of `/dashboard` is not one, so those links silently survived
renames unfixed. Bare paths are what `LinkFixer` handles best and what the router already takes,
the URL path being the store path. Resolution is idempotent, so a link written the old way still
works; the store itself was converted by `V017__portable_internal_links.js`, leaving that
tolerance as a safety net for links arriving by `git pull` or from an old clipboard.
