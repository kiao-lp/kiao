---
status: DRAFT
role: PRIMARY_SOURCE
---

# File optimizations

Enable this plugin in Configuration to add **File optimizations…** to the top banner's
Tools menu. The panel opens over the active tab of the last central area used. Closing it
reveals the previous panel with its state preserved.

The view loads on demand and scans the whole store once per opening. It offers duplicate
consolidation with independent folder and name choices, and a large-file list with batch
deletion. Changes refresh file listings and scan results.

| File | Responsibility |
| --- | --- |
| `index.tsx` | Plugin manifest and menu contribution |
| `FileOptimizationsView.tsx` | Scan state and report tabs |
| `useFileOptimizations.ts` | Worker requests, consolidation and deletion |
| `duplicatesModel.ts` | Choices and consolidation plans |
| `DuplicatesTab.tsx`, `BigFilesTab.tsx` | Reports and confirmations |

See the [solution design](../../../docs/solution-design/file-optimizations.md).
