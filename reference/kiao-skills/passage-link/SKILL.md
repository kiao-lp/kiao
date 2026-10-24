---
name: passage-link
description: This skill should be used when the user asks to "link to a passage", "make a passage link", "link to a sentence or a paragraph of a document", "deep link into a markdown file", "point at specific words rather than at a file", "copy a link to selected text", or when writing or reading a link that carries a `#text=` fragment. Read it before writing any URL fragment meant to select text — the delimiter is deliberately not the one the WICG specification uses.
---

# Passage links — pointing at words, not just at a file

A **passage link** is a link to a markdown document of the store that quotes some of its words.
Opened, Dashboard finds those words in the rendered preview, paints them, and scrolls them about a
third of the way down the pane — where a passage reads best, with what leads into it still above and
what follows still below.

```
/units/abc/cadre.md#text=the%20frame%20is%20drawn%20once
└──────────┬───────┘└──┬─────────────────────────────────┘
   the ordinary bare   the passage: `#text=` and up to four terms
   internal link
```

Reach for one instead of naming a file whenever the point is a sentence, a rule, a definition or a
paragraph — "see `cadre.md`" makes the reader search; a passage link puts them on the words.

## The one thing to get wrong

**Never write `#:~:text=`.** Model training data is full of it, because it is what the WICG
specification *URL Fragment Text Directives* defines and what Chrome's own "copy link to highlight"
produces. It does not work here, and it fails silently — the link opens the document at the top and
nothing says why.

The reason is not a limitation to route around. `:~:` opens the **fragment directive**, which the
specification declares to be for the browser rather than for the document, and browsers enforce
that: Chrome strips it from `location.href` and `location.hash` before the page loads, and strips it
again from any URL handed to `history.pushState`. A page can never read one back. Dashboard therefore
carries the specification's *terms* under a plain `#text=`, which survives both.

```
/units/abc/cadre.md#text=the%20frame        ✅ written by Dashboard, read by Dashboard
/units/abc/cadre.md#:~:text=the%20frame     ❌ stripped before the app ever sees it
```

A `:~:` is still *read* wherever one can still be seen — a link authored in a document, a string
pasted in — so a link somebody's browser wrote is understood. Just never write one.

## The four terms

Terms are comma-separated, in this order, and only `start` is required.

| Term | Written | What it is |
|---|---|---|
| `prefix` | `<prefix>-,` | Words that must sit **just before** the passage. Disambiguation only. |
| `start` | `<start>` | The passage — or its opening words when `end` is given. |
| `end` | `,<end>` | The passage's closing words. `start,end` stands for **everything between them**. |
| `suffix` | `,-<suffix>` | Words that must sit **just after** the passage. Disambiguation only. |

```
#text=is%20drawn%20once                              the passage, quoted whole
#text=the%20frame-,is%20drawn                        …the one preceded by "the frame"
#text=alpha%20bravo,mike%20november                  everything from "alpha bravo" to "mike november"
#text=north%20wing-,is%20drawn,-and%20read           both kinds of context at once
```

The leading `-` on a prefix and the trailing one on a suffix are the markers. That is why a literal
hyphen inside a term has to be encoded.

## Encoding

Percent-encode each term with `encodeURIComponent`, then five characters by hand:

| Character | As | Why |
|---|---|---|
| `-` | `%2D` | marks a context term |
| `,` | `%2C` | separates terms (`encodeURIComponent` already does this) |
| `&` | `%26` | separates directives (idem) |
| `(` `)` | `%28` `%29` | an unbalanced one ends a markdown link destination where it stands |

```js
const term = text => encodeURIComponent(text).replace(/[()-]/g, c =>
    c === '(' ? '%28' : c === ')' ? '%29' : '%2D');
```

A space becomes `%20`, which is not optional: a raw space ends a markdown link destination too.

## How the words are matched

- **Case-insensitive**, so a heading capitalised by the stylesheet still resolves.
- **Whitespace collapsed**, so where the author wrapped the source line does not matter. Quote the
  sentence as it *reads*, not as it is written in the file.
- **Word boundaries.** A term may not cut a word in half: `#text=cat` finds the animal, never the
  middle of "concatenate". Quote whole words.
- **One term never crosses a block.** `prefix` and `start` must be in the same paragraph, heading or
  list item, and so must the passage's end and its `suffix`. A passage *as a whole* may cross one —
  that is what `start,end` is for, and the only form that can.
- **The first match wins.** If the quoted words occur earlier in the document, the link opens there.

## Choosing the form

| The passage is | Write |
|---|---|
| a short, unique sentence | `start` alone |
| long, or crossing a paragraph | `start,end` — a handful of words at each end |
| repeated in the document | add `prefix` and/or `suffix`: the words immediately either side, growing until only one reading is left |

Do not quote a whole section into a URL. Five words at each end are enough, and a URL nobody will
paste is a link nobody will follow.

## Several passages in one fragment

Join them with `&`:

```
#text=the%20first%20wording&text=the%20wording%20before%20the%20edit
```

They are read as **fallbacks, not as several highlights**: the first one the document still holds
wins. That is worth using when a document is being edited and the exact wording may have moved.

## Writing one into a document

An ordinary markdown link, with the path in the store's bare internal form — leading slash, from
the store root, no domain and no `/dashboard`:

```markdown
The rule is stated in [the frame's charter](/units/abc/cadre.md#text=is%20drawn%20once%20and%20read).
```

Same-document links work and cost no reload:

```markdown
See [the lantern paragraph](/smoke/notes.md#text=The%20lantern%20is%20lit) below.
```

## Where it works, and where it does not

- **Works**: the rendered markdown preview of the open `.md` file, whether the link is followed from
  the address bar, from another tab, or clicked inside the app.
- **Does not**: the source pane (its text is markdown source, not rendered text), and a preview of
  something the store has no URL for — a flow node's description in the board's modal.
- **When the words have gone**, because the document was edited, the reader is told so and the
  document opens at the top. Nothing fails silently except a `:~:` you wrote yourself.

## The human's way to get one

Select text in the preview, right-click it, **Copy link to this passage**. That produces an absolute
URL, which works pasted into a mail or a chat; pasted back into a document of the store it is
recognised as internal and stripped to its bare form, fragment and all. The same menu still offers a
plain **Copy** — and everywhere other than over selected text, the browser's own menu is left alone.

## Common Mistakes to Avoid

- **Writing `#:~:text=`.** The single most likely error, and a silent one. Use `#text=`.
- **Quoting the source instead of the rendering.** `**bold**`, `[a link](…)` and a line broken in
  the middle of a sentence are not what the reader sees. Quote the words as they read on screen —
  the markup is not there any more, and the line break is a space.
- **Leaving a space or a parenthesis raw.** The markdown link destination ends there, and the rest
  of the fragment becomes visible text.
- **Forgetting `%2D` for a hyphen inside a term.** `well-known` written raw makes `well` a prefix.
- **Quoting a partial word.** It matches nothing; the link opens at the top.
- **Quoting across a paragraph break in a single term.** Use `start,end`.
- **Assuming a repeated sentence resolves to the one you meant.** It resolves to the first. Add
  context, or quote more of the passage.
- **Putting the whole passage in `start` when it is long.** Use `start,end`; the URL is for pasting.
- **Writing the resolved path.** `/dashboard/units/abc/cadre.md` is what the browser sees, not what a
  document stores. Store `/units/abc/cadre.md` — the app adds its own mount point when it renders
  the link.
