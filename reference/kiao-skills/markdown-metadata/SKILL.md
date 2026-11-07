---
name: markdown-metadata
description: Define or update Markdown document metadata, including status, role and provenance. Use when creating or editing Markdown documents in the store, or when asked about their publication status, source role or derivation. Skill definitions (SKILL.md) must not receive status or role.
---

# Markdown Metadata — Status, Role and Provenance

## Scope

These conventions apply to Markdown documents. **Skill definitions (`SKILL.md`) are
exempt.** Their YAML front matter follows the agent skill schema; adding KIAO's `status` or
`role` keys causes validation errors. Never add these keys to a skill definition. If already
present, remove them while preserving the skill's supported fields, including `name` and
`description`.

## Vocabulary

- **Information source**: a general category covering local or remote documents.
- **Document**: an identifiable, persisted information artifact, created, received, assembled
  or manipulated. This is the central concept of DCMS, regardless of format or intended use.
- **Content**: an identifiable, structured information unit intended for publication or
  distribution. A document need not have this purpose.

## Properties

Use these keys and values in the document's YAML front matter.

### `status`

| Value | Meaning |
|---|---|
| `EXPERIMENTAL` | A document that is neither an information source nor intended for publication. It may be deleted without notice. |
| `DRAFT` | A document intended for publication whose quality is not yet sufficient. |
| `APPROVED` | A validated and published document. |

### `role`

| Value | Meaning |
|---|---|
| `PRIMARY_SOURCE` | A document edited directly to serve as an information source. |
| `DERIVED` | A document generated from one or more other sources. |

### `provenance`

Describe how a derived document is built from other sources.

## Default rule

By default, a Markdown document (except `SKILL.md`) must define `status` and `role`.
If unsure whether this rule applies or which values to use, ask the human.

For example, a primary source being prepared for publication uses:

```markdown
---
status: DRAFT
role: PRIMARY_SOURCE
---

# Document title
```
