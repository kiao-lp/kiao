---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# The markdown document's table of contents

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

The document's tab strip carries an icon that opens the document's headings in a menu: an
overview of what the document contains, and a way to reach a section without scrolling for it.
The markdown plugin hosts the control
([MainView.tsx](../../../../plugins/markdown-edit/MainView.tsx)); the
[menu](../../TableOfContentsMenu.tsx) and the heading
[parser](../../tableOfContents.ts) belong to the markdown editor kit.

`markdownHeadings` reads the ATX headings (`#` to `######`) in file order, skipping the YAML
front matter and anything inside a fence — a `#` line in code is code. The plugin passes the
source it already holds, so unsaved edits are listed too. Each heading carries its 1-based source
line, the line the preview stamps on the rendered block.

Picking a heading calls the editor body's `goToLine`, which reaches both panes: the preview block
stamped with that source line scrolls to the top, and the CodeMirror caret moves to the line and
takes focus. With a pane hidden, only the visible one moves. Source lines are stamped whether one
pane or two are shown, since navigation reads them beyond synchronized scrolling.
