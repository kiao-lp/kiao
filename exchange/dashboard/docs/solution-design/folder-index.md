# Folder index

> Part of the [Dashboard solution design](README.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

A folder holding an `Index` file — the name before the extension, so `Index.md`,
`Index.mmap.json`, … — opens that file instead of its listing, so a folder can read as a page.
The match is case-sensitive, leaving folders of sources full of `index.ts` to browse as folders,
and the first such file listed wins when several coexist. Coming back from inside the folder
(closing the index, or walking up from a descendant) shows the listing instead — that is what
keeps the browser reachable. The rule lives in
[`files/navigation/useIndexAutoOpen.ts`](../../src/cms-core/files/navigation/useIndexAutoOpen.ts).
