---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Linking to a passage

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

Passage links quote rendered words and open the Markdown preview with that passage highlighted
about one-third down the pane. Use **`#text=`**. The
[authoring skill](/agentic-resources/skill-markdown-passage-link/SKILL.md) owns syntax and encoding
examples; this page describes the implementation in `src/core/text-fragment/`.

## Grammar and resolution

A directive has `prefix-,start,end,-suffix`, with only `start` required. Start alone quotes a
passage; start/end delimit a longer or cross-block passage. Prefix and suffix disambiguate
repeated text. Terms match case-insensitively with collapsed whitespace and word boundaries;
one term cannot span blocks. Multiple directives are fallbacks, using the first that matches.

Dashboard uses text-directive terms with its own delimiter. Browsers strip native `:~:` from URLs before page code reads them, including router history updates. The parser accepts `:~:` in document and pasted strings; writers emit `#text=`. Client-rendered Markdown and router navigation require application-controlled matching and placement.

## Code map

| File | Responsibility |
| --- | --- |
| [textDirective.ts](../../textDirective.ts) | Parse and serialize terms |
| [documentText.ts](../../documentText.ts) | Flatten rendered text with block boundaries and an index back to DOM text nodes |
| [matchTextDirective.ts](../../matchTextDirective.ts) | Boundary-aware passage matching |
| [directiveForRange.ts](../../directiveForRange.ts) | Build the shortest selection link, adding context word by word |
| [passageHighlight.ts](../../passageHighlight.ts) | Paint DOM ranges through CSS Custom Highlight, styled by `::highlight(dashboard-passage)` |
| [useTextFragment.ts](../../useTextFragment.ts) | Find, paint and scroll; maintain placement while images/diagrams load, releasing on user interaction |
| [PassageContextMenu.tsx](../../PassageContextMenu.tsx) | Copy text or a link from the selected passage |

Highlights do not insert `<mark>` elements into React-owned output. Source/preview scroll
synchronization remains active, bringing both panes to the passage.

## Copy and scope

The preview checks for a passage in its current selection before opening the shared
[context menu](../../../ui-foundation/interactions/ContextMenu.tsx) at the pointer. The browser
offers its menu when the preview finds no passage. Plain Copy remains beside Copy link.

Copied passage links are absolute Dashboard URLs for sharing. Pasting one into Markdown
uses `normalizeDocumentLink` to produce a DCMS link with the same fragment. Only the open Markdown file enables `passageLinks`
on `MarkdownEditorBody`. Embedded previews such as task descriptions have no document URL that
identifies their text and must not offer passage links. See [internal links](../../../navigation/docs/solution-design/internal-links.md).
