---
name: mindmap
description: This skill should be used when the user asks to "create a mindmap", "modify a .mmap.json file", "add a note to the mindmap", "connect two notes", "add a relation", "group notes", "change a note's shape or colour", "write mindmap", "edit mindmap", or works with .mmap.json files, QuickMindmap documents, or free-positioned note-and-relation diagrams.
---

# Mindmap — Free-Positioned Notes and Relations

A mindmap is a canvas of **notes** — freely positioned boxes whose content is markdown — joined by **relations**. Files use the `.mmap.json` extension. The editor renders notes as HTML boxes on an absolutely positioned surface, with relations drawn as curves between chosen points on their perimeters.

Unlike `graph`, a note carries no title/value structure: it is a small markdown document placed at a point on the canvas, so headings, lists, links, images, code blocks and inline HTML all work inside one.

## File Format

A `.mmap.json` file is a **wrapped document**: the mindmap itself sits under `content`, and the envelope records what kind of document it is.

```json
{
  "content": {
    "elements": {
      "notes": [],
      "relations": []
    }
  },
  "docType": "QuickMindmap",
  "docId": "d57ea35b-6d0b-4f05-9cc8-bd20417d88ee",
  "docTypeVersion": 1,
  "createdAt": "2026-01-21T06:40:44.241Z",
  "updatedAt": "2026-01-21T06:41:34.181Z"
}
```

### Envelope Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | object | Yes | The mindmap: `{ "elements": { "notes": [...], "relations": [...] } }` |
| `docType` | string | Yes | Always `"QuickMindmap"` |
| `docId` | string | Yes | A UUID, generated once and kept for the life of the file |
| `docTypeVersion` | number | Yes | Always `1` |
| `createdAt` | string | Yes | ISO 8601 timestamp, preserved across saves |
| `updatedAt` | string | No | ISO 8601, written by the worker on every save |

`content.elements` is a map of category name to element array. **`notes` and `relations` are the only two categories rendered** — a category with any other name is carried through but never drawn. `content.title` is accepted by the model and unused; the browser tab shows the file name.

### Note Object

```json
{
  "id": "NOTE-Q7xrI2Iz",
  "userBounds": [177, 82, null, null],
  "bounds": [177, 82, 113, 95],
  "content": "# Note A\n\n---\n\nText",
  "zIndex": 3,
  "shape": "rectangle",
  "edge": "solid-1",
  "borderColor": "blue",
  "background": "blue",
  "textAlign": "center",
  "verticalAlign": "top",
  "fontSize": 20,
  "group": "GROUP-k3Bq9tZm"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique across the whole file. Convention: `NOTE-` + 8 random characters |
| `userBounds` | `[x, y, w, h]` | Yes | What the user asked for: position always, width and height as numbers **or `null` for auto** |
| `bounds` | `[x, y, w, h]` | Yes in practice | The measured rectangle, all four numbers. Written back by the editor — see below |
| `content` | string | Yes | The note's markdown, newlines escaped as `\n` |
| `zIndex` | number | No | Stacking order. Notes created by the editor use `3` |
| `shape` | string | No | `ellipse`, `rectangle`, `diamond`. Default `rectangle` |
| `edge` | string | No | How heavy the border is: `none`, `dotted`, `solid-1`, `solid-2`, `solid-4`, `solid-6`, `solid-8`. Default `solid-1` |
| `borderColor` | string | No | What that border is inked in: one of the ten colours below. Omitted, it is the colour every border is drawn in |
| `background` | string | No | What the note is filled with: `none`, or one of the ten colours below. Default `none` |
| `textAlign` | string | No | `left`, `center`, `right`. Default `center` |
| `verticalAlign` | string | No | `top`, `middle`, `bottom`. Default `top` |
| `fontSize` | number | No | Pixels. The editor's grow/shrink commands treat `20` as the starting size |
| `group` | string | No | Group id shared by notes that select and move together. Convention: `GROUP-` + 8 characters |

#### `userBounds` and `bounds`

Two rectangles, and the difference matters when writing one by hand:

- **`userBounds`** is intent: `[x, y, width, height]` where `width` and `height` may be `null`, meaning *size to the content*. An auto-sized note grows to fit its markdown up to **400px wide**, then wraps. A note resized with the wheel gets numbers there and is no longer limited.
- **`bounds`** is the result: `[x, y, width, height]`, all numbers, the rectangle actually measured on screen. The editor measures every note after it renders and writes `bounds` back to the file.

`bounds` is what relations attach to, and **a relation whose target note has no `bounds` is not drawn** — the note shows, the relation does not, until the editor has measured it. So when writing a note by hand, always give it a `bounds`: copy `userBounds`' x and y and put a plausible size after them (`[177, 82, 120, 60]`). The editor corrects it to the real measurement on the next open.

#### The Ten Colours

One palette, used everywhere a colour is chosen — a note's `background`, a note's `borderColor`, a relation's `color`:

`red`, `orange`, `yellow`, `green`, `teal`, `blue`, `violet`, `pink`, `brown`, `grey`

Each name stands for two colours of the theme, and which of the two is used depends on what is being drawn: a **fill** — quiet, meant to be read over — behind a note's text, and an **ink** — meant to be seen on the canvas — along a relation and around a note's border. So a red note and a red relation are the same red without either being drawn in the other's colour.

They belong to the theme rather than to the document, which is what lets a map coloured here keep its meaning in the light theme and in the dark one alike. There is no hex value and no other name: anything outside the ten is silently drawn as the default.

Colour to set a *kind* apart — every note or relation of one kind in one colour — rather than to decorate. `background` and `borderColor` are given independently, so a note can be filled, outlined, or both: an outline alone is the quieter of the two marks, and the one to reach for on a map whose notes are already carrying a fill.

### Relation Object

```json
{
  "id": "REL-m4Xp2Vqd",
  "ends": [
    { "id": "END-a7Kd3Lmn", "target": "NOTE-Q7xrI2Iz", "attachPointNumber": 6 },
    { "id": "END-b2Wc8Rft", "target": "NOTE-M1DgxKiL", "decoration": "FULL_TRIANGLE" }
  ],
  "bend": [0, -40]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique across the file. Convention: `REL-` + 8 characters |
| `ends` | array | Yes | **Exactly two** end objects |
| `bend` | `[dx, dy]` | No | How far the relation's centre is pulled off the middle of its line. Omitted, the relation is straight |
| `color` | string | No | One of the ten colours (see **Colour**). Omitted, the relation is drawn in the colour every relation is drawn in |

A relation is **binary**: it joins two notes and no more. To join three notes, write three relations — or two, from a chosen one of them to each of the others. A relation carrying any other number of ends is not drawn.

#### The Centre and the Bend

A relation passes through a **centre** between its two notes. With no `bend` that centre is the middle of the line and the relation is drawn straight, which is the usual case and what to write unless there is a reason not to.

`bend` moves the centre, in pixels, and the relation becomes a single smooth curve through wherever it lands — one quadratic arc, passing exactly through the centre and leaving each note along the way it runs, not two straight pieces meeting at a corner.

The bend is an offset from the middle rather than a point on the canvas, so a bent relation keeps its shape as its notes are moved. `[0, 0]` is the straight line, so write no `bend` at all rather than that.

In the editor the centre is the small dot on the line: drag it and the curve follows, and its menu offers to straighten it again.

Bend a relation to take it clear of a note or another line it would otherwise cross, or to tell two relations between the same pair of notes apart. A relation that runs through the middle of the map for want of room is still a reason to move a note, not to bend the line around everything in its way.

#### The Body

A relation is drawn as a thin **line** unless an end gives it a `width`. The two ends' widths between them say what shape it is, and the shape runs *along* the curve — it bends with it rather than lying straight across it.

| Shape | Written as | Looks like |
|-------|-----------|------------|
| Line | no `width` on either end | The plain line, and the default |
| Rectangle | the same `width` on both ends | An empty band of one width from note to note — its outline, the map showing through |
| Triangle | `0` on one end, a `width` on the other | A filled wedge, coming to a point at the end that carries the `0` |

```json
{
  "id": "REL-m4Xp2Vqd",
  "ends": [
    { "id": "END-a7Kd3Lmn", "target": "NOTE-Q7xrI2Iz", "width": 0 },
    { "id": "END-b2Wc8Rft", "target": "NOTE-M1DgxKiL", "width": 36 }
  ]
}
```

There is no field naming the shape: the widths are the shape. Which way round a triangle points is which end carries the `0`, the same way an arrow is a `decoration` on the end it points at — the pair of ends stays unordered. Two different widths that are neither equal nor nought make a wedge between them, which is allowed and rarely wanted.

An end with no `width` on a relation whose *other* end has one is taken to be **8** wide, the weight of the line. Write both widths unless that is what is meant.

In the editor everything a relation is drawn with is chosen from the menu its centre opens: the body, how wide it is, its colour, and — for a triangle — a button that turns it round. The wheel over a relation also widens or narrows it, every end at once, so the shape survives the resizing; an end at a point stays a point.

A body is worth giving a relation that carries more weight than the others on the map — a flow, a dependency that dominates. A map whose relations are all bodies has said nothing by making them so.

#### Colour

`color` is the whole relation's — its curve, its body and its decorations alike — and is one of the ten. Omitted, the relation is drawn in the colour every relation is drawn in, which is what a map whose relations all say the same thing wants.

```json
{
  "id": "REL-p8Nr5Yhs",
  "color": "orange",
  "ends": [
    { "id": "END-c9Fj4Bkl", "target": "NOTE-M1DgxKiL" },
    { "id": "END-d5Hm7Nqp", "target": "NOTE-Tz4hWq8b", "decoration": "EMPTY_TRIANGLE" }
  ]
}
```

The ten are the palette a note is coloured from — see **The Ten Colours** — read as ink rather than as fill. Colour a relation to set a *kind* apart, every relation of one kind in one colour, rather than to decorate: ten colours on ten relations say only that somebody had ten colours.

#### Relation End Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique across the file. Convention: `END-` + 8 characters |
| `target` | string | Yes | The `id` of a **note**. Relations attach to notes only |
| `attachPointNumber` | number | No | Which point of the note's perimeter to leave from, `0`–`11`. Omitted, the point is computed: where the line to the note's centre crosses its border. There is no value meaning "computed" — leave the field out |
| `decoration` | string | No | `EMPTY_TRIANGLE`, `FULL_TRIANGLE`, `EMPTY_RECTANGLE`, `FULL_RECTANGLE` — the arrowhead or marker at this end |
| `width` | number | No | How wide the relation's body is here, in pixels. Omitted on both ends, the relation is a plain line — see below |

Direction is not a field: a relation is drawn between its ends, and an arrow is a `decoration` placed on the end it points at.

A relation carries **no text** — there is no label on the line, at either end. What a relation means is said in a small note put beside it, or in the notes it joins.

#### Attach Points

The twelve points run clockwise from the top centre. `w` and `h` are the note's measured width and height:

| Number | Position | Number | Position |
|--------|----------|--------|----------|
| `0` | top, centre | `6` | bottom, centre |
| `1` | top, ¾ across | `7` | bottom, ¼ across |
| `2` | right, ¼ down | `8` | left, ¾ down |
| `3` | right, middle | `9` | left, middle |
| `4` | right, ¾ down | `10` | left, ¼ down |
| `5` | bottom, ¾ across | `11` | top, ¼ across |

Leave `attachPointNumber` out unless the line needs to leave from a particular side. The automatic point follows the notes as they move; a fixed one does not.

On a note drawn as an ellipse or a diamond, a point — fixed or automatic — is taken on that shape's own border rather than on the box around it: the same direction out of the centre, stopped where the shape the reader sees is.

### Note Content

`content` is markdown, rendered by the CMS's own renderer, so anything the CMS renders works inside a note: headings, lists, tables, links, images, fenced code, inline HTML. Newlines are `\n` escapes inside the JSON string.

The editor's paste commands write particular content, worth matching by hand:

- **A pasted link** becomes `[<img src="…/favicon.ico" alt="" width="16" height="16" /> {{{Title}}}](https://example.com)` — the favicon inline, and `{{{Title}}}` left as a placeholder for the author.
- **Pasted code** becomes a fenced block whose language is the placeholder `{{{language}}}`.

## Complete Example

```json
{
  "content": {
    "elements": {
      "notes": [
        {
          "id": "NOTE-Q7xrI2Iz",
          "userBounds": [180, 80, null, null],
          "bounds": [180, 80, 160, 70],
          "content": "# Store\n\nAny folder KIAO is pointed at.",
          "zIndex": 3,
          "background": "blue"
        },
        {
          "id": "NOTE-M1DgxKiL",
          "userBounds": [180, 320, 220, null],
          "bounds": [180, 320, 220, 90],
          "content": "## `.kiao-files`\n\nSays what in a folder is *not* content.",
          "zIndex": 3
        },
        {
          "id": "NOTE-Tz4hWq8b",
          "userBounds": [520, 320, null, null],
          "bounds": [520, 320, 150, 70],
          "content": "Migrations",
          "zIndex": 3,
          "shape": "ellipse",
          "background": "orange"
        }
      ],
      "relations": [
        {
          "id": "REL-m4Xp2Vqd",
          "ends": [
            { "id": "END-a7Kd3Lmn", "target": "NOTE-Q7xrI2Iz", "attachPointNumber": 6 },
            {
              "id": "END-b2Wc8Rft",
              "target": "NOTE-M1DgxKiL",
              "attachPointNumber": 0,
              "decoration": "FULL_TRIANGLE"
            }
          ]
        },
        {
          "id": "REL-p8Nr5Yhs",
          "ends": [
            { "id": "END-c9Fj4Bkl", "target": "NOTE-M1DgxKiL" },
            { "id": "END-d5Hm7Nqp", "target": "NOTE-Tz4hWq8b", "decoration": "EMPTY_TRIANGLE" }
          ]
        }
      ]
    }
  },
  "docType": "QuickMindmap",
  "docId": "6f2a1c4e-9b83-4d17-a0c5-2e7d8f13b904",
  "docTypeVersion": 1,
  "createdAt": "2026-08-24T09:12:03.114Z"
}
```

## Positioning

There is no layout engine — every note carries its own coordinates, in pixels from the top-left of the canvas, and the canvas has no declared size. Guidelines:

- Space notes at least **200px apart** horizontally and **120px** vertically; an auto-sized note is often 120–200px wide and 60–100px tall, and may be up to 400px wide.
- Lay out along the direction the relations flow — top to bottom for a hierarchy, left to right for a sequence.
- Give a note a fixed `userBounds` width when its content is long and should wrap at a chosen point; leave `null` otherwise and let it size itself.
- Keep coordinates positive: the viewport opens at the origin.
- Notes in the same `group` move together — group them when they belong together spatially.

## Editing Guidelines

### Creating a New `.mmap.json` File

1. Write the envelope: `docType: "QuickMindmap"`, `docTypeVersion: 1`, a fresh UUID as `docId`, the current time as `createdAt`.
2. Start `content.elements` with both categories present: `{ "notes": [], "relations": [] }`.
3. Add notes with unique ids, a `content`, a `userBounds` position, and a `bounds` with a plausible size.
4. Add relations last, once the note ids exist.

### Adding a Note

Append a note object to `content.elements.notes` with a new id, a position that does not overlap its neighbours, and both rectangles.

### Connecting Two Notes

Append a relation to `content.elements.relations` with its two ends, each with a new `END-` id and a `target` naming an existing note. Add a `decoration` on the end the arrow should point at.

To relate a note to several others, write one relation per pair. The editor does the same: relating a selection joins every selected note to one of them, one relation each.

### Deleting a Note

Remove the note **and every relation that has an end targeting it** — a relation joins two notes, so losing either leaves nothing to relate. An end left pointing at a missing note is not drawn — silently taking its relation off the map — and nothing in the editor lets it be reached again.

### Restyling a Note

Set `shape`, `edge`, `borderColor`, `background`, `textAlign`, `verticalAlign` or `fontSize` on the note object. Omitting a field means the default, so removing one is how a note is put back to plain.

### Grouping Notes

Give every note in the group the same `group` value — `GROUP-` plus 8 characters. Ungrouping is deleting the field.

### Moving a Note

Change the first two entries of `userBounds` **and of `bounds`** so they agree. Leaving `bounds` at the old position moves the note but leaves its relations attaching where it used to be, until the editor next measures it.

## Common Mistakes to Avoid

- **Writing the mindmap without its envelope** — a bare `{ "elements": … }` is read, but the file should carry `docType`, `docId` and `docTypeVersion`.
- **Dropping `createdAt` or changing `docId` on an edit** — both are preserved for the life of the file.
- **A relation end targeting a note that does not exist** — the relation is dropped from the view, and stays in the file where nothing can reach it. Delete a note and its relations together.
- **A note with no `bounds`** — same result for every relation targeting it, until the editor measures the note. Always write both rectangles.
- **Duplicate ids** — note, relation and end ids must all be unique across the file.
- **Relations targeting a relation** — `target` must be a note id; relations attach to notes only.
- **A relation with any number of ends but two** — the line is computed from a pair, so a relation of one, three or four ends has no geometry and is not drawn.
- **Putting notes or relations outside `content.elements`** — only the `notes` and `relations` categories under `elements` are rendered.
- **Real newlines inside `content`** — JSON strings need `\n`.
- **Inventing style values** — `shape`, `edge`, `borderColor`, `background`, `color`, `textAlign`, `verticalAlign` and `decoration` are closed lists; an unknown value silently renders as the default.
- **Writing a `shape`, a `textOver` or a `textUnder` on a relation** — relations were once routed through nine named shapes and once labelled; they are neither now, and such a field is read by nothing. A line that has to leave the straight path carries a `bend` instead.
- **A `bend` of `[0, 0]`** — that is the straight line the relation already is. Leave the field out.
- **A `width` on one end of a relation and nothing on the other** — the bare end is taken to be 8 wide, not nought, so this is a wedge and not the triangle it looks like in the file. Write `0` for a point.
- **Looking for a field that names the relation's shape** — there is none. A line, a rectangle and a triangle are three ways of writing the two ends' `width`.
- **Putting `color` on an end** — the colour is the whole relation's, and an end carries only what is its own: where it attaches, what it is decorated with, and how wide the body is there.
- **Overlapping notes** — nothing prevents it, and an auto-sized note may be wider than expected. Leave room.
