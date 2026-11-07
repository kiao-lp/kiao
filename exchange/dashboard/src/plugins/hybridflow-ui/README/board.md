---
status: DRAFT
role: PRIMARY_SOURCE
---

# The board

[Board guide](../README.md)

A board is a canvas of positioned nodes joined by successor arrows. Position is presentation;
`onSuccess` defines execution order.

## Where a card sits, and who decides

Each node stores `"spot": { "x": 320, "y": 160 }` in the board record. Positions travel with
board data across clients; they are not browser preferences.

An absent spot means unplaced. On first display, one write assigns spots:

- Initial layout follows chains left to right, with a row per chain.
- Already positioned nodes stay fixed. New unplaced nodes start below them.
- Later renders keep saved positions; only explicit moves rearrange them.

The runner preserves spots when updating execution state. Pasted nodes arrive unplaced to avoid
collisions on a different canvas; clones keep an offset position near their source.

## The gestures

| Gesture | Result |
| --- | --- |
| Click / double-click | Open the panel / expanded editor |
| Right-click node | Node actions |
| Right-click empty canvas | Create a node or class, instantiate, or paste at that point |
| Mouse drag a node | Move it; a marked node carries the visible marked set |
| Touch drag | Scroll the canvas |
| Drag a chain knob | Set a successor; on a Gateway, add a branch |

During a move, nodes follow the pointer and arrows update once per frame. Creation offers
seven node kinds and four class kinds; new nodes are unnamed and open in their editor.
See [node types](flow-node-types.md) and [multi-card gestures](editing-cards.md#several-cards-at-once).

## The arrows

All arrows share a relation layer above workflow backgrounds and below cards, including
links across workflows. Strokes receive hover events; empty space passes events through.
Link dragging resolves targets through any strokes it crosses.

Arrows meet actual card edges along the line between centers. `useCardHeights` measures
rendered heights so tags and controls do not misalign endpoints. The canvas has no fixed
reading direction.

A solid line means `continue` with a forked chat; a dashed line means no chat handoff.
Links to filtered or archived endpoints are not drawn. See [handoff rules](on-success.md).
