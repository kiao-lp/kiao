# Linking to a passage

> Detail of [ARCHITECTURE.md](../../../../exchange/dashboard/ARCHITECTURE.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

**A link may name a passage of a document by quoting it**, and the document opens on those words —
highlighted, and scrolled to where they read best. The grammar is not Chrome's, though Chrome is
where it is best known: it is the WICG specification *URL Fragment Text Directives*, and the browser
feature that acts on one is called *scroll-to-text-fragment*. The name for one passage's worth of it
is a **text directive**, and that is what [`text-fragment/`](../../../../exchange/dashboard/src/cms-core/text-fragment/) reads and
writes:

```
/units/abc/cadre.md#text=the%20frame-,is%20drawn%20once,-%2C%20and%20read
                    └─┬──────────────────────────────────────────────────┘
                      the text directive — one passage, up to four terms
```

The four terms are `prefix-,start,end,-suffix`, all optional but `start`. `start` alone quotes the
passage whole; `start,end` quotes its two ends and stands for everything between, which is how a
long passage — or one crossing a paragraph — is named without putting it all in the URL. `prefix`
and `suffix` are context: text that must sit either side of the passage, added only when the quote
alone would match in more than one place.

**The terms are the specification's; the delimiter cannot be.** The specification puts its
directives behind `:~:`, the *fragment directive*, and says everything past it is for the browser
rather than for the document. Browsers take that literally: Chrome removes it from `location.href`
and `location.hash` before the page loads, and removes it again from any URL handed to
`history.pushState`. A page cannot read a `:~:` fragment at all — not on arrival, not after a router
navigation. That is not an oversight to route around, it is what makes the feature the browser's
own. So the terms are written under a plain `#text=`, which the browser leaves alone; a `:~:` is
still *read* wherever one can still be seen — a link authored in a document, a string pasted in — so
a link Chrome wrote is understood everywhere except across the address bar, which no page-side code
could have fixed.

**And the browser's own behaviour would not have served in any case**, for two structural reasons.
The markdown is fetched and rendered client-side, so at the moment a browser looks for the text
there is no document yet; and an in-app link becomes a router navigation ([Internal links](internal-links.md)), which is not a
document load and so triggers nothing. Two more things it withholds would have had to go anyway:
where the passage comes to rest — it centres the match, and `::target-text` is nearly the only thing
that may be said about the highlight — and the copy side, since "copy link to highlight" belongs to
the browser's own menu, which disappears the moment a page draws one of its own.

| File | What it is |
| --- | --- |
| [`textDirective.ts`](../../../../exchange/dashboard/src/cms-core/text-fragment/textDirective.ts) | The grammar and the vocabulary: text in, terms out, and back. Start there. |
| [`documentText.ts`](../../../../exchange/dashboard/src/cms-core/text-fragment/documentText.ts) | The rendered document read into one searchable string — whitespace collapsed, case folded, a boundary between blocks — with an index back to the text node every character came from. A sentence carrying a bold word is three nodes; reading it flat once is what makes the search plain string work. |
| [`matchTextDirective.ts`](../../../../exchange/dashboard/src/cms-core/text-fragment/matchTextDirective.ts) | Finding the passage: matches fall on word boundaries, and no single term ever spans a block. |
| [`directiveForRange.ts`](../../../../exchange/dashboard/src/cms-core/text-fragment/directiveForRange.ts) | The copy side — the smallest directive that names the selection *and nothing before it*, growing context a word at a time until it does. |
| [`passageHighlight.ts`](../../../../exchange/dashboard/src/cms-core/text-fragment/passageHighlight.ts) | Painting it through the **CSS Custom Highlight API** rather than a `<mark>`: the rendered document belongs to React, and an element inserted into it would be torn out by the next pass. Painting a range touches nothing. Styled from `cms-core.css` under `::highlight(dashboard-passage)`. |
| [`useTextFragment.ts`](../../../../exchange/dashboard/src/cms-core/text-fragment/useTextFragment.ts) | The loop that finds, paints and places — and holds the passage there while images and diagrams above it finish arriving, then lets go. It lets go early the moment the reader touches anything: a link says where to open a document, not where to keep it. |
| [`PassageContextMenu.tsx`](../../../../exchange/dashboard/src/cms-core/text-fragment/PassageContextMenu.tsx) | The right-click that offers the link back. |

**Two things already answered "where does this document open?", and both give way.** The scroll
memory ([View state](view-state.md)) is left out for the whole visit of a passage link — not read back, which would fight
the placement, and not written, since arriving on a passage is not the reader leaving their place
somewhere new. The synchronized source/preview scrolling is *not* suspended: the preview is scrolled
to the passage and the sync carries the source pane across to it, so both panes settle on the same
words.

**The right-click is decided per click.** `<PassageContextMenu>` takes it over only where it lands on
selected text; everywhere else it stops the event before Ant Design's trigger sees it — in a real
capture listener, since React delivers events from the root of the app and the trigger calls
`preventDefault()` the instant it is delivered one — and the browser's own menu opens as it always
did, which for a right-click on an image or a link is worth more than anything the app would put in
its place. It offers a plain **Copy** beside the link, the menu it displaced having offered one.

The link copied is absolute, so it works pasted into a mail or a chat; pasted back into a Dashboard
document it is recognised as internal and stripped to its bare form by `toStoredLink`, fragment and
all. Only the markdown editor of the open file turns this on (`passageLinks` on
`MarkdownEditorBody`): a pane showing something the store has no URL for — a flow node's description
in a modal — would be offering a link to a document that does not hold the passage.
