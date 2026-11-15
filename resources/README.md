# KIAO mark — Prism Mind

**[`kiao-2026-prism-mind.svg`](kiao-2026-prism-mind.svg) is the KIAO mark.** The K opens
like a prism: one mind goes in, a spectrum comes out, and each beam lands on its own
agent at the rim.

Product derivations sit beside it: `kiao-2026-dcms.svg`, `kiao-2026-go.svg`,
`kiao-2026-play.svg`.

## Palette

```
--k-bg      #020411   canvas (and keyline)
--k-lift    #16204A   canvas glow
--k-gold    #F2B654   the family constant — frame, never per product
--k-gold-lt #FFE2A8   fourth beam
--k-gold-dk #8A5A16
--k-human   #FF4F87   the human side / fifth beam
--k-ai      #22D3EE   the agent side / second beam
--k-accent  #7C5CFF   first beam
--k-mint    #3DDC97   third beam
--k-spark   #FFFFFF   the point of contact
```

Gold carries the frame — the ring and the letter. Colour is spent only on the part of
the mark about *people and agents*: the beams and the seats.

## Format

Each icon is **one hand-written SVG file**: no external references, no embedded raster,
no font dependency. Every colour goes through a CSS custom property declared at the top
of the file, and every property has a literal fallback on the element itself, so the
icons still render correctly in a viewer that ignores CSS variables.

## Deriving a product icon

One additive edit — the base file is never forked. **Fill the product slot:** a 60 px
disc centred on **(60,196)**, keylined 7 px in the canvas colour (r37 underlay) so it
punches cleanly over whatever it sits on, holding a ~30 px glyph. Bottom left is
deliberate: it costs a little of the ring, and never touches the K.

The product hue is spent on that disc and nowhere else. The spectrum *is* the family —
five beams, five agents — so overriding `--k-accent` or `--k-ai` to recolour collapses
the fan instead of colouring it. The gold carries the frame, the spectrum carries the
family, the slot carries the product.

Product hues: DCMS `#22D3EE`, Play `#FF4F87`, Go `#3DDC97`, MCP `#7C5CFF`.

## Editing later

The pieces are named in each file (`#canvas`, `#human`, `#spectrum`, `#k`, `#crew`,
`#product-slot` — a comment in the base mark, a group in derivations), so a later flow
node can address one without disturbing the rest. The knobs, if a variant is wanted:
the fan angles, the brain folds, the ring radius and weight, and the corner radius
(`rx="48"`; `0` for a flat square).

The `.png` next to each `.svg` is only a preview — the Dashboard image viewer handles
png/jpg/gif/webp but not svg, so the previews are what make these visible in the CMS.
The SVG is the source.
