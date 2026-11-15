---
name: markdown-metadata
description: Define or update Markdown document metadata, including status, role and provenance. Use when creating or editing Markdown documents in the store, or when asked about their publication status, source role or derivation. Skill definitions (SKILL.md) must not receive document metadata.
---

# Markdown Metadata — Status, Role and Provenance

## Scope

These conventions apply to Markdown documents. **Skill definitions (`SKILL.md`) are
exempt.** Their YAML front matter follows the agent skill schema; adding a `document`
key causes validation errors. Never add it to a skill definition. If already
present, remove it while preserving the skill's supported fields, including `name` and
`description`.

## Vocabulary

- **Information source**: a general category covering local or remote documents.
- **Document**: an identifiable, persisted information artifact, created, received, assembled
  or manipulated. This is the central concept of DCMS, regardless of format or intended use.
- **Content**: an identifiable, structured information unit intended for publication or
  distribution. A document need not have this purpose.

## Properties

Store these keys under `document` in the YAML front matter.

### `document.status`

| Value | Meaning |
|---|---|
| `EXPERIMENTAL` | A document that is neither an information source nor intended for publication. It may be deleted without notice. |
| `DRAFT` | A document intended for publication whose quality is not yet sufficient. |
| `APPROVED` | A validated and published document. |

### `document.role`

| Value | Meaning |
|---|---|
| `PRIMARY_SOURCE` | A document edited directly to serve as an information source. |
| `DERIVED` | A document generated from one or more other sources. |

### `document.provenance`

Describe how a derived document is built from other sources.

## Default rule

By default, a Markdown document (except `SKILL.md`) must define `document.status` and `document.role`.
If unsure whether this rule applies or which values to use, ask the human.

For example, a primary source being prepared for publication uses:

```markdown
---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Document title
```

## Decision records

The ADR format is defined separately by [kiao-adr](../kiao-adr/SKILL.md).
