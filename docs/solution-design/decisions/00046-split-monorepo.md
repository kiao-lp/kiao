---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-10-03
tags: ["repo", "monorepo", "split"]
triggers: ["personal code in pub", "outward reference", "hostname", "standalone repo", "subtree split", "old monorepo path", "VITE_OIDC_AUTHORITY", "example.com"]
supersedes: []
superseded_by: []
---

# 00046 — Pub holds base KIAO without outward references.

## Context and Problem Statement

The base distribution must build, run and remain readable without another checkout,
one person's server or personal files. Assemblies still need explicit extension points.

## Considered Options

* Keep the base self-contained and receive assembly inputs through extension points.

Other considered options were not recorded.

## Decision Outcome

Chosen option: "Keep the base self-contained and receive assembly inputs through extension points",
because extensions can depend on the base while the base remains independently usable.

The base contains DCMS, hybridflow, reference libraries and skills, file-store migrations,
e2e verification and image/executable tooling. It has no personal products, external
assembly paths, personal hostnames or names, or defaults requiring a particular machine.

A secured Dashboard receives its realm at build time; production worker requires issuer
and JWKS URIs; examples use `example.com`. Assemblies supply plugins, extra skills,
action providers and deployment configuration through declared inputs.

Documentation follows the
[ownership and portable-link rules](00061-direct-solution-design-and-reference-packages.md).
