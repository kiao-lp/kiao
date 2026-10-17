---
name: mlunit
description: This skill should be used when the user asks to "create a unit", "add a unit", "name a unit", "retitle a unit", "add an episode to a series", "create a sommaire", "create an index unit", or works with .mlunit.json documents, KIAO learning units, series and their episodes. Read it BEFORE creating or retitling a unit: the title is the name of the unit's folder, and retitling moves it.
---

# Units — how one is titled, and where that title ends up

A **unit** is a folder of the store: a `<docId>.mlunit.json` document plus one file per piece of
content — articles, podcasts, exercise sets — chained in order. A unit is written in one language,
and it reaches a reader by being a member of a **sommaire** (an index unit: a unit whose `members`
list other units by path).

Units are created and edited through the `kiao-units` MCP tools — `unit_create`, `unit_update`,
`unit_index_create`, `unit_index_add` — never by writing the JSON by hand. Those tools carry the
whole schema. This skill is the one thing a schema can only state in a line: **what to call a
unit**.

## The title is a folder name

`unit_create` writes the unit into a folder named after its title, and `unit_update` renames that
folder when the title changes:

```
units/Cell division/                      ← a unit of its own
  08tp38iwk4dhazd0t7jefh.mlunit.json      ← the document keeps the docId
  cadre.md                                ← the article
  introduction.ttst.md                    ← the podcast

units/Human biology/                      ← a series: its sommaire…
  idx.mlunit.json
  episodes/Cell division/                 ← …and its episodes, under it
    08tp38iwk4dhazd0t7jefh.mlunit.json
```

So the title is read in a file tree, in a path, in a link, and in the player's list. Two rules
follow, and they are the whole of it:

- **Short.** A few words naming the subject — not a sentence, not a summary.
- **Unnumbered.** Never put the sequence number in it: no `S3`, no `Sequence 3`, no `Séquence 3`,
  no `Part 2`, no `03 -`.

| Write | Not |
|---|---|
| `Cell division` | `S3 - Cell division` |
| `Passive voice` | `Sequence 12 — The passive voice and its uses` |
| `TCP handshake` | `Module 2, part 1: how a TCP connection is opened` |

## Why the number never goes in

**The order is the sommaire's, not the title's.** A unit's rank in a series is where its path sits
in that sommaire's `members`, and `unit_index_add` inserts at any position — rewriting that list and
touching no unit. So a series is reordered and an episode slipped in between two others for the cost
of one call, while every number spelled into a title is now a lie, and putting them right means
retitling every episode of the series — which moves every one of their folders with it.

**A unit may be listed by several sommaires.** `unit_index_add` does not remove it from anywhere
else, so a title claiming one rank would be wrong in every other series that lists it.

## Retitling moves the folder

`unit_update` renames the unit's folder to the new title — the folder's **name**, not its place, so
a unit filed under a topic of its own or sitting in its series' `episodes/` is retitled where it
stands. Nothing else has to be written: worker's link fixer repairs, in the same pass, every
reference to what was inside the folder — the `members` entry of every sommaire listing the unit,
the `unit::` links of the articles naming it, and the unit's own `contents[].path`. Retitling a
series moves its episodes with it, references and all.

That repair follows a reference only where it is written as a **link** — from the store root, with a
leading slash: `/units/Ma série/cadre.md`. Every reference a unit document holds is written that way,
and the slash is what tells one from a path merely mentioned in prose. Write one that way too.

Two consequences worth knowing:

- **The path a unit answers to changes.** `unit_update` returns the new one; a path held from
  before the call addresses nothing. `unit_list` pairs every docId with its path.
- **Another unit may hold the name.** A title is not an identity, so when the folder the title asks
  for is taken, the unit steps aside into `<name> (docId)` — the same rule `unit_create` follows.

## Where the framing goes instead

`description` — the unit's blurb. A couple of sentences at most, saying what the unit covers and
what the reader gains. That is where "the third of five sessions on cell biology" belongs, if it
belongs anywhere; the title stays the subject.

The sommaire itself is titled by the same rules: the series' subject, short, unnumbered.

## What the store does to a title

`toStoreName` (`reference/npm/kiao-worker/src/utils.ts`) makes the folder name. It keeps the title as
it reads — spaces, accents, case, parentheses, em dashes all survive — and takes out only what a
path, a filesystem or a URL cannot hold: `: * ? " < > | #` and control characters go, `/` and `\`
become `-`, leading and trailing dots and spaces are trimmed, and the name is capped at 180 UTF-8
bytes. A title left empty, punctuation-only or equal to a Windows device name (`NUL`, `COM3`) falls
back to the docId, which is a folder nobody can read.

A short title never meets any of this. A long one is silently cut mid-title in the path.

## Common Mistakes to Avoid

- **Numbering the title** — `S3 - …`, `Épisode 4 : …`. The sommaire's `members` order carries the
  rank; the title carries the subject.
- **Writing a sentence.** A title is a name, not a summary. The summary is `description`.
- **Retitling to *move* a unit.** Retitling renames the folder where it stands; it never changes
  the folder it is in. To file a unit somewhere else, move it — or create it with `folder` set.
- **Announcing the type.** "Index of…", "Table of contents", "Podcast:" — a reader has no use for
  it, and it is already what the document is.
- **Repeating the series in every episode.** The episode already lives inside the series' folder
  and inside its sommaire; `Human biology — cell division` says it a third time.
