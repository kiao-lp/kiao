---
status: DRAFT
role: PRIMARY_SOURCE
---

# Tags

The Tags panel manages a flat, ordered list in `kiao-user-config/tags.json`:

```json
[
  { "label": "bug", "color": "#e66767" },
  { "label": "ui", "color": "#3987e5" }
]
```

This is an ordinary, versioned store file. A missing file means an empty list; adding the
first tag creates it. Refresh flushes pending edits before rereading the file.

## The word is the tag

Documents store words directly: `"tags": ["bug", "ui"]`. No ID lookup is required, so tags
remain readable by people and agents and retain their meaning when copied between stores.
The catalogue supplies colors only; an unknown word still appears in neutral grey.

Renaming or deleting a catalogue entry leaves document tags unchanged. Those words lose
their color until a matching entry is added again. The panel confirms deletion and explains
this effect; it never scans or rewrites documents to rename a tag.

## What it claims

The manifest omits `fileConfigFor`; `code-edit` opens the JSON file. The plugin contributes
a Tags tab, an app-lifetime provider and the `tags.ui` capability. The provider loads on
first use and shares one list between the panel and consuming documents. It survives
document navigation so pending edits are preserved.

## Files

| File | Role |
| --- | --- |
| `index.tsx` | Manifest, tab, provider and capability |
| `tagsFile.ts` | Parsing, serialization, palette and color lookup |
| `Tags-ctx.tsx` | Shared list and debounced persistence |
| `TagsPanel.tsx` | Add, rename, color, reorder and delete controls |
| `TagChip.tsx` | Tag chip and chip list |
| `TagPicker.tsx` | Document tags and catalogue additions |

## Where a tag is made

Typing a new word into a document's picker immediately adds it to the store catalogue,
using the first unused palette color. The Tags panel also supports creation and manages
colors, labels and order.

## The colour

Colors are hex values. The eight initial choices match the activity-log palette and cycle
after all have been used. Each chip computes black or white text from the fill's luminance
using [the color kit](../../kit/color/ink.ts), keeping it readable in either theme.

## Who wears them

Hybridflow cards show tags below the title and offer the picker in both editors; see
[board tags and filtering](../hybridflow-ui/README/tags.md). Other plugins consume
`TagPicker` and `TagChips` through the capability, with the absence behavior defined in
[the runtime contract](../../../docs/solution-design/plugins-runtime.md).
