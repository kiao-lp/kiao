# SVG images

Edits `.svg` — the store's vector images — on a canvas and as source. The canvas draws the
file itself, so what is edited is always what the image is: no preview beside an editor,
the drawing is both.

## Gestures

They are the mindmap's: double click the bare canvas to drop a shape of the kind the top
bar holds, drag one to move it — or everything selected with it — and drag the handles of
a shape picked out on its own to resize it. A box drawn over the bare canvas selects what
it touches, the arrow keys nudge, the wheel resizes a shape about its centre — its width,
or its height with Shift — and Delete takes the selection. Double clicking a text edits
it in place.

The keys are standard ones: Ctrl+D duplicates, Ctrl+Shift+F and Ctrl+Shift+B restack to
front and back, Alt+Arrow resizes the single selected shape (Shift for a fine step), and
Alt+Up/Down grows the font of a text, as does the wheel rolled over one. A right-click on
a shape opens the same verbs as a menu — duplicate, restack, text size, delete — with
each key written beside it.

Copy, cut and paste speak standalone SVG on the system clipboard, so a piece of a drawing
pastes into any graphics tool as well as into another drawing. The brush in the top bar
hands the new-shape style to the shapes already drawn.

## Files

- `model.ts` — the shapes and the pure geometry (move, resize, boxes).
- `svgDocument.ts` — the two arrows between the file's text and the drawing. Anything the
  canvas does not edit (`defs`, `style`, unknown elements) is carried through verbatim.
- `state.tsx` — the drawing on screen and the file under it, the mindmap split between
  moving and saving.
- `components/SvgViewport.tsx` — the canvas and its gestures.
- `components/SvgContextMenu.tsx` — the right-click menu over a shape.
- `hotkeys.tsx` — the standard hotkeys
  (see [commands-hotkeys.md](../../../docs/solution-design/commands-hotkeys.md)).
