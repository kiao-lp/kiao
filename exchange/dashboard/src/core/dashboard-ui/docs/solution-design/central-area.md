---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# The central area

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

[LayoutContent](../../layout/LayoutContent.tsx) renders the panel areas. Its pinned
[Document tab](../../documents/DocumentPanel.tsx) contains the editor or folder listing,
shared scroller. Each toolbar tab has its own host stack rendered by the shell. Content comes
from context so tab registration never captures a stale view. Plugin main views render
`LayoutContent` and `TopBanner`; CSS places the banner above the content.

## Document-scoped dialogs

[useDocumentArea](../../documents/DocumentArea-ctx.tsx) exposes the document element
to descendants, including toolbar panels. Use it as antd's `getContainer` with absolutely
positioned mask and wrapper to cover only the document. Surrounding controls stay usable.
Outside the layout the hook returns `null`; fall back to the window.

## Panel stack

[CentralStack](../../documents/CentralStack-ctx.tsx) hosts forms and editors over a
central tab. Each panel fills its host and has a floating close control; covered panels remain
mounted, preserving state. There is no mask or focus trap, so users can keep using the file
tree and drag files into a form. Confirmations remain modals.

- Push with `useCentralStack().push({ id, ... })`. A stable ID replaces an existing panel
  on top rather than creating duplicates.
- Close with `close(id)` from any descendant or use the frame's cross. `onClose` runs whenever
  the panel leaves, allowing its opener to retain state.
- Read changing content from context rather than capturing it in the pushed element.
- The top panel owns the right of its host's tab strip. Set `additionalPanels` when pushing
  static controls, or render `CentralPanelControls` inside the panel for controls using its
  local state and providers. Closing it restores the previous panel's controls, or the tab's
  controls when the stack is empty. A panel with no controls leaves that space empty.

A panel's `host` names its tab; Document is the default and comes forward when a panel arrives.
Other hosts display their panels only in that tab. Git diff and search results use
document-hosted panels. Hybridflow's template forms use its own
Board host. See [board UI](../../../../plugins/hybridflow-ui/docs/solution-design/board-ui.md).

Plugins declare `toolsMenuItems` to open panels from the top banner's “…” menu. Each entry
provides an id, label, optional icon and `panel` content. The shell selects the host at click
time from the active tab of the last central area used. Pointer interaction, keyboard focus
and programmatic tab selection update that area; closing the second central area falls back
to the first. The open document stays mounted and the selected tab stays selected.

[ToolsMenuProvider](../../top-banner/ToolsMenu-ctx.tsx) collects the enabled
manifest contributions and connects the banner to the primary layout's stack. Embedded
documents keep a separate local stack and do not replace that connection. A missing layout
disables the contributed entries. Entries are built with `stackPanelItem`.
