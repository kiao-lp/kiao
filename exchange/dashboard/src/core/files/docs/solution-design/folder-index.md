---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Folder index

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

A folder holding an `Index` file (`Index.md`, `Index.mmap.json`, …) opens that file in place of its listing. The match is case-sensitive, so source folders with `index.ts` browse as folders. The first listed `Index` file wins when several coexist. Returning from inside the folder (closing the index, or walking up from a descendant) shows the listing. The rule lives in [`files/navigation/useIndexAutoOpen.ts`](../../navigation/useIndexAutoOpen.ts).
