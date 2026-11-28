---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-08-15
owner: "NEN"
tags: ["links", "routing", "dashboard"]
triggers: ["internal link", "basename", "context path", "copied URL", "/dashboard prefix", "router navigation", "VITE_BASE_PATH", "BASE_URL", "InternalLinkNavigator", "resolveLink", "LinkFixer", "V017"]
supersedes: []
superseded_by: []
---

# 00006 — Dashboard resolves DCMS links against BASE_URL.

## Context and Problem Statement

DCMS links must survive domain and mount changes and remain recognizable by `LinkFixer`.

## Considered Options

* Write DCMS links and resolve them against `BASE_URL` for display.

Other considered options were not recorded.

## Decision Outcome

Chosen option: "Write DCMS links and resolve them against `BASE_URL` for display",
because the stored reference remains independent of deployment location.

New writes use DCMS links such as `/units/abc/cadre.md`.
`navigation/internal-links.ts` resolves display hrefs against `import.meta.env.BASE_URL`;
resolution is idempotent, so an existing mount prefix still displays correctly.
`InternalLinkNavigator` routes internal anchor clicks.

`VITE_BASE_PATH` sets the build-time mount, defaulting to `/dashboard/`.
`App.tsx` derives the router basename and OIDC redirect from the same value.
