---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# The board

[Board guide](../README.md)

The canvas draws cards for positioned flow nodes and arrows for successor links. Position is presentation;
`onSuccess` defines execution order.

## Where a card sits, and who decides

Each node stores `"spot": { "x": 320, "y": 160 }` in the board record. Positions travel with
board data across clients; they are not browser preferences.

Dragging the edge of a selected card saves its dimensions as `"size": { "w": 260, "h": 140 }` on the flow node.
The width is always part of a stored size; an absent height keeps the card's natural height, so
wrapped text still grows the card. Sizes travel with the board like spots.

An absent spot means unplaced. On first display, one write assigns spots:

- Initial layout follows chains left to right, with a row per chain.
- Already positioned nodes stay fixed. New unplaced nodes start below them.
- Later renders keep saved positions; only explicit moves rearrange them.

The runner preserves spots when updating execution state. Pasted nodes arrive unplaced to avoid
collisions on a different canvas; clones keep an offset position near their source.

## The gestures

| Gesture | Result |
| --- | --- |
| Click | Open the panel |
| Right-click a card | Flow node actions |
| Right-click empty canvas | Create a flow node, paste a copy, or fill copied templates and instantiate at that point |
| Drag a card | Move it, along with the visible marked cards if it is marked |
| Drag a selected card's edge | Change its width from a side, its height from the top or bottom |
| Touch drag | Scroll the canvas |
| Drag a chain knob | Set a successor; on a Gateway, add a branch |

During a move, cards follow the pointer and arrows update once per frame. New nodes
are unnamed and open in their editor.
See [node types](flow-node-types.md) and [multi-card gestures](editing-cards.md#several-cards-at-once).

Resize edges are shown on the selected card. The card grows or shrinks from the edge being
dragged and does not move as a whole; a left or top edge keeps the opposite edge where it was.
Each kind has a minimum width and height, and a Gateway or event never narrows below its shape.

## The arrows

All arrows share a relation layer above workflow backgrounds and below cards, including
links across workflows. Strokes receive hover events; empty space passes events through.
Link dragging resolves targets through any strokes it crosses.

Arrows meet actual card edges along the line between centers. `useCardHeights` measures
rendered heights so tags and controls do not misalign endpoints. The canvas has no fixed
reading direction.

A solid line means `continue` with a forked chat; a dashed line means no chat handoff.
Links to filtered or archived endpoints are not drawn. See [handoff rules](on-success.md).
