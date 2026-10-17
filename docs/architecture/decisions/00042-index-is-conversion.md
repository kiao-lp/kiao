---
id: "00042"
title: "a document index is a conversion, and its mtime says who wrote it"
status: accepted
date: 2026-09-08
tags: ["search", "index", "formats"]
components: ["worker", "dashboard"]
paths: ["operation/worker"]
symbols: ["POST /reindex", ".index.md", ".index.csv", ".index.txt", "## Page n"]
triggers: ["pdf search", "docx search", "xlsx search", ".msg", ".eml", ".doc", "companion tab", "stale index", "hand-written index"]
supersedes: []
superseded_by: []
---

# 00042 — a document index is a conversion, and its mtime says who wrote it

**Decision:** the sibling file a document is indexed into is the format the *source* deserves, not a
text dump: `.pdf`, `.docx`, `.pptx`, `.odt` and the two mail formats become `<name>.index.md` with
headings, list items and pipe tables; `.xlsx`, `.xlsm` and `.ods` become `<name>.index.csv`, one
record per row. `.eml` and `.msg` join the set. `.index.txt` stays a recognised index — it is what
earlier versions wrote — and a document carrying several is read through one of them, in a fixed
order of preference. `POST /reindex` is how a folder is converted on purpose, and *Rebuild search
index* in the file browser is the gesture that calls it.

**Why a conversion.** The index was written for one reader — the search walk, which only needs a
grep to find a word. But it is also a **companion tab of the document**, offered next to it in
Dashboard, and it is what an agent reads when it is handed a folder: both of those read it as a
document, and neither can do anything with a wall of tab-joined cells. A spreadsheet whose index is
CSV opens in a spreadsheet; a Word document whose index is Markdown has a table of contents. The
work is the same walk over the same XML — the structure was being *discarded* on the way out — so
what was being saved by dumping text was nothing.

**Search reports a line, and that is what fixes the granularity.** A hit comes back as a line number
and the line's content, so the unit a converter emits is the unit a person sees in the result list.
That is why a spreadsheet is one record per row rather than one cell per line (a hit shows the whole
record, which is the meaningful thing in a workbook), why a PDF gets `## Page n` (extracted PDF text
has no other landmark, and the page number is what lets somebody go and look), and why a slide deck
is one section per slide.

**The mtime is the provenance.** A generated index is stamped with its source's modification time.
Every question then answers itself from two stats: an index *older* than its source is out of date,
one of the *same* age is the one this service wrote, and one that is **newer** can only have been
written by a person — through the companion switch's `+`, or by hand — because nothing automatic can
produce it. That last case is never overwritten and never deleted, by the search pass or by an
explicit rebuild; deleting it is how somebody asks for the document to be converted again. The
alternative was a provenance marker inside the file, and it would have cost every format its
cleanliness — a comment line CSV has no syntax for, a banner at the top of every Markdown index —
to say something two timestamps already say.

**Converting a store is asked for, never done on the way past.** A `.index.txt` that is current is
*not* stale: it describes the document correctly, it is just not the shape this version writes. So
`/search` leaves it alone and only `/reindex` rewrites it. Otherwise deploying this version would
have made the first search in every store delete and rewrite thousands of files — a burst of writes,
a git status nobody asked for, and all of it triggered by somebody typing a word in a box. A
rewrite, when it does happen, leaves exactly **one** index: the superseded suffix is removed, or the
old file would keep sitting there answering with text from a version ago that nothing refreshes.

**No new dependency, and none possible.** The service ships as one static CGO-free binary that a
Docker image and the VPS both run with nothing installed beside it, which rules out the usual
answer to "read a .msg" — a Python library, a LibreOffice headless, a converter on `PATH`. So the
formats are read where they stand: the zip+XML families through the engine that was already there
(now told what a heading and a table are), `.eml` through `net/mail` and `mime/*`, and `.msg`
through a compound-file reader written here — an OLE2 container is a FAT filesystem in a file, and
the part a search index needs from it is the part that is stable and specified. Only PDF keeps a
third-party parser, because a page is positioned glyphs against a font encoding and that is not
something to reimplement for an index. Every reader is bounded on its own — source size, generated
text, per-part decompression, MIME depth and breadth, sector chains no longer than the file that
holds them — because indexing drives off what is on disk and `/upload` is only one of the ways a
document gets there.

**`.doc` is still not indexable, and `.msg` is.** They are the same OLE2 container, which is what
makes the omission look arbitrary. It is not: a `.msg` stores each property in a stream *named after
that property*, so reading one is looking up a name; a legacy `.doc` stores its text as a piece
table over a stream of formatted characters, which is a different parser and a much larger one for a
format the store sees far less of.
