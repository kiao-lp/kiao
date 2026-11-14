---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# The import gate (`src/core/import-gate/`)

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md) · [Upload review](../../../files/docs/solution-design/upload-review.md).

The upload review scans every readable file, highlights findings and lets the reviewer navigate
or redact them before import. `ReviewFile.textPath` points to the converted index, the original
text file, or nothing for unreadable binaries. The Safe-import gate uses that same readable set.

## Rendering and redaction

Markdown renders as a document. [paintFindings.ts](../../paintFindings.ts)
maps scanned source text to rendered DOM ranges through the CSS Custom Highlight API without
mutating React's elements. Matching uses text because Markdown markers and offsets change on
render. Findings spanning elements still highlight; text changed by rendering stays listed in
the navigator even if it cannot be painted.

The current finding can be replaced with `[...]`. Rescanning updates findings and counts;
redacted text stays with review decisions and is written to staging before import moves.
Redacting a text file changes the imported file. Redacting a converted index leaves the binary
original untouched; choose **Import as text** when the original must be discarded.

## Store rules

`kiao-user-config/import-gate/` contains one JSON file per category, with named regex rules and
criticality `critical`, `high`, `medium` or `low`. Categories include credentials, classification,
personal data, finance, HR, networks and intellectual property. Worker seeds a missing folder
once; store owners then maintain and version it.

[importGateConfig.ts](../../importGateConfig.ts) reloads the directory
on every upload. A missing folder yields an empty gate. Invalid individual patterns are logged
and skipped without preventing valid rules or sibling categories from loading.

## Code and visual rules

| Source | Responsibility |
| --- | --- |
| [matchers.ts](../../matchers.ts) | Rule format and forgiving reads |
| [scan.ts](../../scan.ts) | Bounded text, per-rule hits and total hits; overlap resolution by criticality |
| [GatedTextView.tsx](../../GatedTextView.tsx) | Reader, findings and navigation |

Criticality uses fill, underline shape and a word label so color is not the only cue. Count
chips filter the navigator, leaving all findings painted for context.
