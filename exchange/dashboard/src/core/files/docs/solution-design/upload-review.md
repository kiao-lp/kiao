---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Uploading, and the review it opens (`src/core/files/service/ui/`)

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

Uploads land in a worker-managed staging area excluded from listings, then undergo text-index
conversion before [UploadReviewModal](../../service/ui/UploadReviewModal.tsx)
opens. The left tree shows uploaded files and decisions; the right pane shows readable text
through the [import gate](../../../import-gate/docs/solution-design/import-gate.md). Nothing reaches the destination until import.

| Per-file choice | Result |
| --- | --- |
| Delete | Discard staged file |
| Import | Keep original and applicable index |
| Import as text | Keep converted index instead of the original; remove `.index` from its name, e.g. `report.pdf.index.md` → `report.pdf.md` |

Import as text appears only when conversion produced an index. Decisions start unset.

## Exit actions

- **Cancel:** discard the staging area and everything in it.
- **Safe import:** enabled once every readable file has a decision. Readable includes converted
  documents and existing text files; unreadable binaries need no decision.
- **Unsafe import:** available immediately, styled red, with no additional confirmation.

Both import actions use the same plan; undecided files are imported. Their difference is the
decision gate, not the move operation.

[uploadReview.ts](../../service/ui/uploadReview.ts) builds the review tree,
evaluates the gate and plans folder creation followed by one `moveBatch`. `folderUpload.ts`
walks dropped trees and uploads into staging. Review uses uploaded paths and `/reindex`'s
returned index paths rather than rereading `/listRecursive`, which caps results and hides
subsidiaries. Redacted texts are written to staging before moves.
