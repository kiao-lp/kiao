---
status: DRAFT
role: PRIMARY_SOURCE
---

# File optimizations (`src/plugins/file-optimizations/`)

Part of the [Dashboard solution design](README.md).

The optional `file-optimizations` plugin contributes **File optimizations…** through
[`toolsMenuItems`](../../src/plugins/file-optimizations/index.tsx). Configuration selects
whether the plugin loads. Its view is lazy-loaded when the menu entry opens it over the
active tab of the last central area used. Closing returns to the previous panel or document;
covered panels remain mounted.

## Scan

Worker's `GET /fileOptimizations` groups equal-size files by content hash and honors
`.kiao-files` exclusions. Only size groups with multiple entries need hashing. Dashboard
scans once on open and again on Re-scan or after consolidation
([useFileOptimizations.ts](../../src/plugins/file-optimizations/useFileOptimizations.ts)).

## Duplicate consolidation

Each group offers independent **location** and **name** choices: the best name may belong to a
copy in the wrong folder. Radios represent distinct folders and names, so equivalent choices
highlight together. Nothing is selected by default; both choices are required before the
button enables. [duplicatesModel.ts](../../src/plugins/file-optimizations/duplicatesModel.ts)
owns these rules for the view, confirmation and tests.

`POST /deduplicate` moves copies onto the chosen path through the link fixer, repointing
references instead of leaving broken links. Worker re-hashes before changes and returns
**409** if contents diverged or an unrelated file now occupies the destination. The view displays
the service's explanation and rescans after success.

## Large files

The report lists sizes with bars relative to the largest file. Selecting rows enables batch
deletion with a confirmation listing the selected paths. One worker request deletes the batch
and repairs links; Dashboard refreshes file listings and scan results afterwards.
