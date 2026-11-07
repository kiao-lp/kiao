---
status: DRAFT
role: PRIMARY_SOURCE
---

# Dragging a file out of the store (`src/cms-core/files/dnd/`)

Part of the [Dashboard solution design](README.md).

Store rows in the tree, folder table and grid carry paths to folder move targets or path-input
fields. [dragPaths.ts](../../src/cms-core/files/dnd/dragPaths.ts) writes and reads the payload:

| MIME type | Purpose |
| --- | --- |
| `application/x-kiao-paths` | Store paths for move/copy targets |
| `application/x-kiao-folders` | Which paths are directories |
| `text/plain` | External applications only; never accepted back as proof of a store file |

Both copy and move effects are allowed. Folder rows move; text targets copy a path or link.
Dragging is disabled on coarse pointers, where a press opens the row menu.

## Drop targets

| Target | Result |
| --- | --- |
| Flow-node folder field | Dropped folder, or parent of a dropped file; `/` for root |
| Template `file` variable | Store-root path, with `.name` available to templates |
| Flow-node description, panel or expanded editor | Markdown link at the drop point |
| Chat composer or expanded composer | Markdown link at the caret; browser `Files` drops remain attachments |
| Mindmap rich text | Markdown link at the drop point |

[useFileDrop](../../src/cms-core/files/dnd/useFileDrop.ts) highlights eligible path fields,
passes the first entry and leaves unrelated drags to the browser.
[markdownLinkDrop](../../src/cms-core/files/dnd/markdownLinkDrop.ts) provides CodeMirror insertion.
Links use the normal stored form: root-relative and percent-encoded. Template file values stay
unescaped because they may become ordinary prose or agent input.

During `dragover`, data is unavailable; `holdsDraggedFiles` checks MIME types instead. A target
must accept that event to receive the drop. See [internal links](internal-links.md).
