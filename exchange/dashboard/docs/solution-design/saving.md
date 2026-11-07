---
status: DRAFT
role: PRIMARY_SOURCE
---

# Saving

Part of the [Dashboard solution design](README.md).

Editors save as the user types. The standard debounce is **1000 ms**. Do not add a Save button.
For a document opened from a file, use [disk-sync hooks](disk-sync.md) before implementing
loading and persistence separately.

All writers follow these rules:

- **Loading is not an edit.** Initial reads bypass setters that schedule writes.
- **Pass path and payload as writer arguments.** A pending write must reach its original file
  even after navigation.
- **Flush on exit:** provider unmount and `beforeunload`.
- **Flush and await before a service reads the stored file**, such as an action or export.
- **Ctrl+S** suppresses the browser's save-page dialog and flushes pending edits.

Git provides document history; the editor should not hold changes until an explicit save.
