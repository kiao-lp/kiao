---
status: DRAFT
role: PRIMARY_SOURCE
---

# Row lists (`src/cms-core/ui-foundation/layout/row-lists.css`)

Part of the [Dashboard solution design](README.md).

Row tables (`<table>` or stacked `div`s) follow two rules.

**Zebra.** Even rows use `var(--table-even)`; odd rows keep the container surface. Native tables get this from `kiao-style` (`table tbody tr:nth-child()`). `div` lists opt in with `.kiao-zebra-rows` on the rows' parent. Zebra sits at the bottom of row states:

```
zebra  <  hover  <  current/pointed  <  selected
```

Every state beats the stripe by specificity, never by source order. Zebra selectors stay minimal (a lone class, or `:where()`). Where rows share a parent with non-rows, filter with `:nth-child(even of .row-class)`.

**Width.** `.kiao-row-list` is `width: 100%` up to `--row-list-max-width` (920px). The elastic column takes `width: 100%`; fixed columns stay fixed.

Exceptions: the feature matrix, whose row colour encodes MoSCoW priority (`plugins/featmat-view/featmat-view.css`); lists reflowing into a variable column count, where stripes band diagonally.
