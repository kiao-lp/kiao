# tags

The words a store files its work under, and the colour each one is worn in.

```json
[
  { "label": "bug", "color": "#e66767" },
  { "label": "ui",  "color": "#3987e5" }
]
```

The file is **`kiao-user-config/tags.json`** and there is nothing else: no index, no id, no
sidecar. A tag is one entry of it, the order is the order of the array, and the list is flat —
there are no categories and no hierarchy.

It is an ordinary store file, committed with the rest and one click away as JSON, which is why the
panel has a refresh: what was written there wins, and what the panel owes always leaves before it
reads. It is also **optional** — a store that has never named a tag has no file, which is the empty
list, and the first tag creates it.

## The word is the tag

**A document that carries tags carries the words** — `"tags": ["bug", "ui"]` — and never an id
pointing here. That one decision is what the rest follows from:

- a document stays **readable and writable by hand**, by a Claude turn holding the `hybridflow`
  skill, and by anything else that writes one, with no second file to look anything up in;
- a card **travels**. Copied into another instance of KIAO, `bug` still means bug there, while an
  id minted here would name nothing at all — which is exactly what a `chat` does, and why one never
  travels and a tag always does;
- a word this file has never heard of is **still a tag**. It is worn in the neutral grey and says
  its word, which is what a document written before the file existed, or in another store, or by
  hand, deserves.

What it costs is the **rename**: editing a label in the panel renames the *entry*, and cards
already carrying the old word keep it — they simply go grey. That is visible rather than silent,
and it is the price of a document that says what it means on its own. Nothing here rewrites the
store to chase a rename, and nothing should: a pass over every document in the tree is a large
thing to hang on a text box.

## What it claims

**Nothing.** `fileConfigFor` returns `null` for every file — `tags.json` is JSON, and `code-edit`
shows it as such — so the plugin is one tool bar tab and the provider behind it, like `bookmarks`
and `claude`.

The provider is app-level, and for one reason more than the bookmarks panel has: the list has **two
readers**. The panel lives in a tool bar, which every navigation between documents replaces; and
the colours are worn on the cards of a board, which is a main view. One list, read once, above both
— and read the first time something asks for it, never on a page load nobody wanted it on.

## Files

| File | Role |
| --- | --- |
| `index.tsx` | Manifest: the tab and the provider. |
| `tagsFile.ts` | The format: what the file says, what is written back, the palette a new tag is coloured from, and the paint a word is worn in. |
| `Tags-ctx.tsx` | The list, and the debounced writes back to the store. |
| `TagsPanel.tsx` | The panel: the box a tag is named in, and a row per tag — its colour, its word, its grip and its delete. |
| `TagChip.tsx` | One tag as it is worn, and the row of them a document shows. |
| `TagPicker.tsx` | The tags of an open document, picked from the store's and added to it. |

## Where a tag is made

**In the picker, most of the time.** A word typed into a document's own tag picker is added to this
list on the spot, with the first colour no tag holds. A tag that had to be declared before it could
be used is a tag nobody declares, and a two-step errand through another tool bar is how a store
ends up with no tags at all.

So the panel is not mainly where tags are *made*: it is where they are **coloured, renamed,
reordered and thrown away**. It has a box of its own all the same, for the store being set up
before there is anything to tag.

## The colour

A hex, and the eight the picker offers first are the activity log's — a categorical palette
validated for colour-blind separation. Past the eighth the palette starts again rather than going
grey: the ninth tag is a real tag, and the neutral colour means *this store has not said*.

**A chip carries both halves of its own contrast.** The fill is the colour chosen, and the ink on
it — black or white — is computed from that colour's luminance
([`@cms-kit/color`](../../kit/color/ink.ts)), so a chip reads on a card, in a select and in either
theme without depending on the surface under it. That is why one colour serves both themes here,
where the activity log's bar needs a step per theme: the bar's segments sit *on* a themed row, and
a chip sits on itself.

## Deleting

The panel asks, and says what goes: the entry leaves the file, and **the cards keep the word**.
They lose its colour, which is the honest thing for a store to say about a word it has stopped
knowing — and putting the word back gives every one of them its colour back at once.

## Who wears them

`hybridflow-ui` today: a flow node carries `"tags": [...]`, the card wears them under its title, and
both faces of the flow node editor offer the picker. See
[`plugins/hybridflow-ui/README.md`](../hybridflow-ui/README.md#tags). Nothing about the format is
the board's, so the next document type to want them needs the picker and the chips and nothing else.
