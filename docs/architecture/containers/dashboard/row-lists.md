# Row lists (`src/cms-core/styles/cms-core.css`)

> Detail of [ARCHITECTURE.md](../../../../exchange/dashboard/ARCHITECTURE.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

Anything that reads as a table of rows — a real `<table>` or a stack of `div`s — follows two
rules, so the whole app treats them alike.

**Zebra.** Alternating row backgrounds, `var(--table-even)` on the even row while the odd one
keeps its container's surface. Native `<table>`s get this for free from `kiao-style`
(`table tbody tr:nth-child()`), so only `div`-based lists opt in, with `.kiao-zebra-rows` on
the parent of the rows. Zebra sits at the **bottom** of the row's states:

```
zebra  <  hover  <  current/pointed  <  selected
```

Every state must beat the stripe by *specificity*, never by source order — which is why the
zebra selectors are kept as low as they can go (a lone class, or wrapped in `:where()`). Where
rows share a parent with non-rows, filter the count with `:nth-child(even of .row-class)`
rather than letting the strangers shift the alternation.

**Width.** `.kiao-row-list` gives a list `width: 100%` up to `--row-list-max-width` (920px). A
list stretches with its pane and then stops: a row whose ends sit at opposite edges of a wide
screen is exactly what the stripe is there to prevent. Give the one elastic column
`width: 100%` so it takes the slack and the fixed columns stay put.

One list opts out on purpose: the feature matrix, whose row colour already encodes MoSCoW
priority (see `plugins/featmat-view/featmat-view.css`). A list that reflows into a variable column
count is the other case — stripes would band diagonally across it.
