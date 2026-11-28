---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-11-28
tags: ["dcms", "terminology", "links", "dashboard", "worker"]
triggers: ["DCMS link", "Copy DCMS link", "document-relative Markdown", "dcmsLinkOf", "encodedDcmsLinkOf", "normalizeDocumentLink"]
---

# 00075 — DCMS link names a reference resolved from the DCMS root.

## Context and Problem Statement

Dashboard introduced the label **Copy relative path** for a command that copies
`/docs/guide.md`. In a document that reference opens from the DCMS root. The file API
returns `docs/guide.md` for the same file, while a Markdown destination written that way
resolves from the containing document. Dashboard adds its mount point to produce a browser href.

## Considered Options

* Keep the terms used by each component for the reference.
* Use *DCMS link* across documentation, implementation and interface text for the reference
  resolved from the DCMS root.

## Decision Outcome

Use *DCMS link*. The shared name identifies the base of resolution wherever the reference
appears, including Markdown destinations and structured document fields. **Copy DCMS link**
names what the clipboard receives. File API paths, document-relative links and Dashboard URLs
use their own terms so that callers can tell which form a field or operation expects.

Existing wire fields, persisted values and applied migrations retain their formats. The old
helper exports remain available for existing callers.

## More Information

The [DCMS concept catalog](../../architecture/data/dcms-concept-catalog.md) defines current
usage. [ADR 00028](00028-leading-slash-links.md) records the choice of token boundaries for
link repair. [ADR 00006](../../../exchange/dashboard/docs/solution-design/decisions/00006-bare-internal-links.md)
records how Dashboard resolves links against its mount point.
