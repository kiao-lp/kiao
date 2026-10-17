---
name: markdown-anchors
description: This skill should be used when the user asks to "add a table of contents", "link to a heading", "write an internal anchor link", "fix a broken # link", or works with in-document # links, heading slugs, or GFM anchors in markdown.
---

# Markdown Anchors — In-Document Links That Work Everywhere

Write an internal anchor link (table of contents, cross-reference within a document) so it
works in every renderer this repository cares about: Dashboard markdown preview, PDF
download, GitHub and VS Code.

## Syntax

```markdown
[Link text](#heading-slug)
```

Where `heading-slug` is the **GFM slug** derived from the heading text.

## How Heading Slugs Are Generated

All renderers use the **GitHub Flavored Markdown (GFM)** slug algorithm:

1. **Lowercase** — all characters are converted to lowercase
2. **Spaces → hyphens** — each space becomes a `-`
3. **Remove punctuation** — characters other than `-`, `_`, and letters/digits are removed
4. **Accented characters are preserved** — `é`, `è`, `à`, etc. are kept as-is
5. **Leading digits are preserved** — unlike some older algorithms, `## 1 Intro` produces `1-intro`, not `intro`
6. **Duplicate handling** — if two headings produce the same slug, the second gets `-1` appended, the third gets `-2`, etc.

## Examples

| Heading | Slug | Link syntax |
|---|---|---|
| `## Introduction` | `introduction` | `[Intro](#introduction)` |
| `## 1 — Cadre et vocabulaire` | `1--cadre-et-vocabulaire` | `[§1](#1--cadre-et-vocabulaire)` |
| `## Annexe — Sources` | `annexe--sources` | `[Annexe](#annexe--sources)` |
| `## API Gateway, BFF, Service Mesh` | `api-gateway-bff-service-mesh` | `[API Gateway](#api-gateway-bff-service-mesh)` |
| `## Décider : grille de l'architecte` | `décider--grille-de-larchitecte` | `[Grille](#décider--grille-de-larchitecte)` |
| `## Saga & cie` | `saga--cie` | `[Saga](#saga--cie)` |

## Common Pitfalls

### Em-dashes (—) produce double hyphens

The `—` character is removed, but the spaces around it each become hyphens, producing `--`:

```
## Annexe — Sources  →  annexe--sources
```

### Colons (:) produce double hyphens too

Same mechanism — the colon is removed, surrounding spaces remain:

```
## Décider : grille  →  décider--grille
```

### Apostrophes are removed silently

```
## grille de l'architecte  →  grille-de-larchitecte
```

### Ampersands (&) are removed

```
## Saga & cie  →  saga--cie
```

### Plus signs (+) are removed

```
## Strangler Fig + ACL  →  strangler-fig--acl
```

## Quick Reference: Full Table of Contents Pattern

```markdown
## Sommaire

1. [Cadre et vocabulaire](#1--cadre-et-vocabulaire)
2. [Communication entre services](#2--communication-entre-services)
3. [Annexe — Sources](#annexe--sources)

---

## 1 — Cadre et vocabulaire
...

## 2 — Communication entre services
...

## Annexe — Sources
...
```

## Technical Implementation

| Context | Mechanism |
|---|---|
| Dashboard preview | `rehype-slug` plugin (uses `github-slugger`) adds `id` attributes to headings |
| PDF download | Inherits heading IDs from the rendered DOM |
| GitHub / VS Code | Native GFM support |
