# The import gate (`src/cms-core/import-gate/`)

> Part of the [Dashboard solution design](README.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

The text on the right of that dialog is not shown raw. The store's **import gate** is run over it,
and what it finds is highlighted where it sits, with a navigator above to step from one finding to
the next. The reason is that nobody reads an eleven-page conversion of a folder somebody handed
over on a key: what a reviewer can answer is *is there anything in here I should not import*, and
that is a question about a handful of spots rather than about the text.

**Everything readable goes through it, not only the converted.** A `.md` note, a `.csv` export or a
`.json` dump needs no conversion to be read, and a gate that only ran over indexes would wave
through exactly the files whose secrets are in plain sight. So `ReviewFile` carries a `textPath` —
the index when there is one, the file itself when it *is* text, `''` for an image or an archive —
and that is the set both the reader and the Safe-import gate work from.

**Markdown is shown as a document, not as its source.** An index is Markdown and so is much of what
anyone uploads, so the pane renders it. That moves the highlighting: a rendered document belongs to
React, nothing of ours may be inserted into it, and the findings go to the browser as *ranges*
through the CSS Custom Highlight API instead — the same mechanism, and the same reasoning, as the
passage a `#text=` link names. [`paintFindings.ts`](../../src/cms-core/import-gate/paintFindings.ts) does
the mapping, and it maps by **text** rather than by offset: the scan reads the Markdown *source*
(that is where a redaction has to cut) while the paint lands on the rendered output, where the
markers are gone and a table is a grid. A passage the rendering split across elements is still found
and still one range; one it *changed* is not painted, and keeps its place in the navigator anyway.

**A finding can be taken out.** Beside the two step buttons is a third that obfuscates the one the
navigator is standing on: it becomes `[...]` in the text, the gate re-reads and the finding is
gone — from the counts as well as from the page. It is a decision about what gets imported and is
kept with the decisions, not in the reader: at import time the redacted texts are written back into
the staging area *before* anything moves, which is what keeps the move itself an ordinary
`moveBatch`. Note what it does and does not reach: redacting the text of a `.md` or a `.txt` edits
the file that lands, while redacting a converted document's index edits the index — the binary
original still holds the passage, so *Import as text* is the answer where the original must not
carry it.

The gate is the store's own, in `kiao-user-config/import-gate/` — one JSON document per **category**
(credentials, classification markings, health and other article-9 data, personal identifiers,
financial data, HR records, network topology, contracts and IP), each a list of named regular
expressions with a **criticality** of `critical`, `high`, `medium` or `low`. worker seeds the
folder on a store that has none and never touches it again, so it is edited by hand, committed with
the store, and extended with categories only that store needs.
[`importGateConfig.ts`](../../src/cms-core/import-gate/importGateConfig.ts) reads it afresh at every
upload — one listing and a few small documents — so an edit is in force at the next upload and
there is no cache anyone has to invalidate. A store with no folder has an empty gate, and the reader
is exactly what it was before.

[`matchers.ts`](../../src/cms-core/import-gate/matchers.ts) is the format and nothing else. It is
deliberately unforgiving of nothing: these files are hand-edited in a store that is in use, so a
rule with a broken pattern is dropped with a line in the console and its eight neighbours — and its
seven sibling categories — still load. [`scan.ts`](../../src/cms-core/import-gate/scan.ts) runs them,
bounded on three axes (the text read, the hits per rule, the hits in all), resolves the overlaps two
rules always produce over the same characters in favour of the more critical, and cuts the text into
the runs to draw. [`GatedTextView.tsx`](../../src/cms-core/import-gate/GatedTextView.tsx) draws them.

**Criticality is the whole point of the highlight**, so it is carried three ways over: a fill, an
underline shape, and its own word in the navigator — a reviewer who cannot separate the red from the
orange still has to be able to separate a leaked key from a postcode. The counts come before the
reading and are also the filter: pressing *2 critical* narrows the walk to those two without
changing what is painted.
