---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# SVG images

Edits `.svg` directly on a canvas or as source. The drawing is the editable image itself.

## Gestures

| Gesture | Action |
| --- | --- |
| Double-click empty canvas | Create the toolbar's selected shape |
| Drag a shape | Move it and any selected peers |
| Drag a single shape's handles | Resize |
| Draw a selection box | Select intersecting shapes |
| Arrow keys | Nudge |
| Wheel / Shift+wheel | Resize width / height around center |
| Double-click text | Edit in place |
| Ctrl+D | Duplicate |
| Ctrl+Shift+F / Ctrl+Shift+B | Bring to front / send to back |
| Alt+Arrow, with Shift for a fine step | Resize one selected shape |
| Alt+Up/Down or wheel over text | Change font size |
| Delete | Remove selection |

The shape context menu offers the same actions with shortcuts. Copy, Cut and Paste use
standalone SVG on the system clipboard for exchange with other drawings and graphics tools.
The toolbar brush applies the new-shape style to existing shapes.

## Files

| File | Responsibility |
| --- | --- |
| `model.ts` | Shapes and pure geometry |
| `svgDocument.ts` | Parse/serialize while preserving untouched `defs`, styles and unknown elements |
| `state.tsx` | Transient drawing state and persistence |
| `components/SvgViewport.tsx` | Canvas gestures |
| `components/SvgContextMenu.tsx` | Shape menu |
| `hotkeys.tsx` | [Command registration](../../core/hotkeys/docs/solution-design/commands-hotkeys.md) |
