# Uploading, and the review it opens (`src/cms-core/files/service/ui/`)

> Part of the [Dashboard solution design](README.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

The upload zone at the foot of the file browser does not write into the folder being browsed. It
asks worker for a **staging area** — a directory of the store that no listing shows, see
`PROTOCOL.md` — uploads the picked files or the dropped folder into it, has the documents converted
into their indexes there, and opens [`UploadReviewModal`](../../src/cms-core/files/service/ui/UploadReviewModal.tsx):
the tree of what arrived on the left, the text of the selected document's index on the right, and a
*Delete* / *Import* choice above it with neither chosen. The choice is reported next to the file in
the tree.

The choice is in fact three: *Delete*, *Import*, and **Import as text** — which imports the
document's *index* in its place, under the file's own name with `.index` taken out
(`rapport.pdf.index.md` becomes `rapport.pdf.md`), and lets the original go with the staging area.
It is offered only where a conversion actually wrote something, since otherwise there is nothing to
put in the file's place, and it is what a scanned PDF nobody will open again is worth keeping as.

Three ways out. **Cancel** discards the staging area with everything in it. **Safe import** is
offered only once every *readable* document has been decided — one whose text was shown, which is
the converted documents plus the files that are text already; a file nothing could be read of is
never waited on, because nothing was shown of it to decide from. **Unsafe import** is red, offered
from the start, and asks nothing further. The two imports run the same operation: an undecided file
is imported either way, and what differs is only what each demands before it is offered.

The split is the usual one. [`uploadReview.ts`](../../src/cms-core/files/service/ui/uploadReview.ts) is the
rules with no UI in them — assembling the review from the tree that was uploaded and the indexes
`/reindex` says it wrote, the tree the dialog draws, the gate on Safe import, and the plan an import
runs (the folders to create, then one `moveBatch` of everything kept). `folderUpload.ts` is unchanged
below it: it still walks a `DataTransfer` and uploads a tree, and only its target moved.

Nothing is read back from the server to build the review. The uploader knows every path it sent and
`/reindex` answers with the index **files** it wrote, so "does this document have something to read"
is a set membership; `/listRecursive` would be a round trip that caps at 500 entries and hides
subsidiaries, which is to say it hides what is being asked about.
