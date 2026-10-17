---
id: "00045"
title: "what the gate reads, what it renders, and what a reviewer may cut out"
status: accepted
date: 2026-09-08
tags: ["import-gate", "review", "redaction"]
components: ["dashboard"]
paths: []
symbols: ["textPath", "CSS Custom Highlight API", "#text=", "[...]"]
triggers: ["render markdown review", "mark element", "redaction", "obfuscate", "import as text", ".md import", "rapport.pdf.md"]
supersedes: []
superseded_by: []
---

# 00045 — what the gate reads, what it renders, and what a reviewer may cut out

Four decisions that arrived together, once the gate had been used.

**Every readable text goes through it, not only the converted ones.** A `.md` note, a `.csv` export
or a `.json` dump is text without anything having had to convert it, and a gate that ran only over
indexes would wave through exactly the files whose secrets are in plain sight. So a review file
carries a `textPath` — its index where there is one, itself where it is text, empty for an image or
an archive — and both the reader and the Safe-import gate work from that. Safe import consequently
waits on more files than before, which is the point.

**Markdown is rendered, not shown as source.** An index is Markdown; so is much of what anybody
uploads. Reading `# Heading` and `- item` as characters is reading a file, and the question the
dialog asks is about a document. The cost is that highlighting can no longer be a `<mark>`: the
rendered DOM belongs to React and an element of ours would be torn out on its next pass. So those
findings go to the browser as ranges through the **CSS Custom Highlight API**, exactly as the
passage a `#text=` link names does, and for the same reason.

That forces one more choice: **the gate always reads the source.** The scan, the offsets and the
redaction are the Markdown source's — that is the file that will land in the store, and the only
thing a cut can be made in. The paint is then mapped onto the rendering by *text* rather than by
offset, because no offset mapping between source and rendering is worth writing. A passage the
rendering split across elements is still found and still one range; one it changed — a finding that
swallowed the `**` around a word — is not painted and keeps its place in the navigator regardless.

**Import as text** is the third answer, offered only where a conversion wrote something: the index
lands in the file's place, named `rapport.pdf.md` rather than `rapport.md`, because the index is a
*reading of a particular document* and the folder should say which. The original is not moved, so it
goes when the staging area does. It is what a scanned PDF nobody will open again is worth keeping
as, and it is the honest partner of the redaction below.

**Obfuscating cuts the passage out of the file that lands.** The button beside the two step buttons
replaces the current finding with `[...]`; the gate re-reads and the finding is gone from the counts
as well as from the page. It is a decision about what gets imported, so it is kept with the
decisions rather than in the reader, and it is carried out by writing the redacted text back into
the staging area *before* anything moves — which is what keeps the import itself a plain
`moveBatch`. Its reach is worth being explicit about: redacting a `.md` or a `.txt` edits the file
that lands, while redacting a converted document's index edits the index only — the binary original
still holds the passage. *Import as text* is the answer when it must not.

Also fixed here, and the reason the rest was noticed: the app's stylesheet paints every `pre` in the
code colour on the code surface, so the whole preview came out red. It is a document and now reads
in the page's own ink.
