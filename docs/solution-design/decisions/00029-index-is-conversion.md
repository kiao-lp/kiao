---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-08
tags: ["search", "index", "formats", "worker", "dashboard"]
triggers: ["pdf search", "docx search", "xlsx search", ".msg", ".eml", ".doc", "companion tab", "stale index", "hand-written index", "POST /reindex", ".index.md", ".index.csv", ".index.txt", "## Page n"]
supersedes: []
superseded_by: []
---

# 00029 — Document indexes are conversions; mtime protects handwritten ones.

## Context and Problem Statement

Search indexes also serve as companion tabs and agent-readable documents. Flat text
discards structure needed by those readers. Refreshes must distinguish generated indexes
from handwritten ones and avoid rewriting a store merely because someone searches it.

## Considered Options

* Convert documents to structured Markdown or CSV and use modification times for provenance.
* Keep flat text dumps as the generated index format.
* Put a provenance marker inside each index file.
* Rewrite current old-format indexes automatically during search.
* Depend on external conversion programs.

## Decision Outcome

Chosen option: "Convert documents to structured Markdown or CSV and use modification times for provenance",
because readable structure can be retained without format-specific provenance markers.

`.pdf`, `.docx`, `.pptx`, `.odt`, `.eml` and `.msg` produce
`<name>.index.md` with headings, lists and pipe tables. `.xlsx`, `.xlsm` and `.ods`
produce `<name>.index.csv`, one record per row. Since search returns a line number and
content, each row must be meaningful; PDFs use `## Page n` and slide decks one section
per slide. Existing `.index.txt` files remain recognized; multiple indexes have a fixed
read preference.

Generated indexes receive their source's mtime. Older means stale, equal identifies service
output, and newer identifies a handwritten index, including one created through the
companion tab's `+`. Neither automatic refresh nor explicit rebuild overwrites or deletes
a newer index; deleting it requests conversion again.

Search leaves a current `.index.txt` alone. **Rebuild search index** calls
`POST /reindex` to request format conversion explicitly. A rewrite leaves one index,
removing the superseded suffix so stale content cannot remain readable.

The Docker image and executable share one static CGO-free service without external
converters. Existing zip/XML readers retain document structure; mail uses `net/mail`
and `mime/*`; `.msg` uses an in-process OLE2 compound-file reader. PDF retains its
third-party parser because positioned glyphs need specialized extraction. Readers bound
source and output sizes, per-part decompression, MIME depth and breadth, and sector-chain
lengths, since files can enter the store outside `/upload`.

### Consequences

* Good, because timestamps protect edits without inserting a CSV comment or Markdown banner.
* Bad, because legacy `.doc` remains unindexable despite sharing OLE2 with `.msg`:
  named property streams suffice for mail, whereas Word needs a larger piece-table parser
  for a less common format.
