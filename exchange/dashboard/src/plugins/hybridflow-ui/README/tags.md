---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Tags

[Board guide](../README.md) · [Tag catalogue and picker](../../tags/README.md)

Tasks carry tag words directly:

```json
{ "id": "task-1", "title": "Write the plan", "tags": ["bug", "ui"] }
```

The tags plugin supplies optional colors and controls through `tags.ui`. Unknown words still
appear in neutral grey and retain their meaning across stores. Tags wrap below the title.
Both task editors offer the picker; entering a new word adds it to the store catalogue.

## The filter above the board

The canvas offers the board's own tags in alphabetical order. Multiple selected chips match
**any** selected word. It shows the visible/total count and a clear control. Boards with no
tags, or assemblies without `tags.ui`, omit the row.

Filtering changes no board data or persisted view state. It belongs to the open board and
resets when leaving it. Hidden nodes retain their data and execution state, but marks on them
are excluded from all gestures. Arrows with a hidden endpoint are not drawn.

The runner preserves tags when updating nodes and ignores their meaning. Synchronization
merges tag edits like other user-authored fields.
