# Saving

> Detail of [ARCHITECTURE.md](../../../../exchange/dashboard/ARCHITECTURE.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

**Every editor in this CMS saves as you type. There is no Save button anywhere, and a new plugin
must not add one.** A change to a document is a write: the plugin puts the edit through a
`lodash.debounce`d writer — 1000 ms is the house delay — so a burst of keystrokes becomes one
write. Git is the safety net that a Save button used to be, so nothing is gained by holding an
edit back and a lost one costs the user their work.

For a plugin that opens one file, the `disk-sync` hooks (next section) *are* this rule, disk
following included — reach for them before writing a load effect and a debounced writer of your
own. What the rule implies, for the writers that stay hand-rolled:

- **Loading is not an edit.** Route edits through a setter that schedules the write, and let the
  initial load bypass it — writing a file back the moment it is opened is a commit per file opened.
- **Give the debounced writer its path and payload as arguments**, not from a closure over the
  current file: a write still pending when another file is opened must land on the file it was
  made in (`TemplatePersistence-ctx`).
- **Flush on the way out** — provider unmount and `beforeunload` — or the last second of typing is
  lost to a debounce that never fires.
- **Get ahead of the debounce before handing the file to a service.** An action or an export
  reads the file from the store, so those paths flush first and await the write.
- **Ctrl+S** keeps only its two jobs: swallow the browser's "save page" dialog, and flush.
