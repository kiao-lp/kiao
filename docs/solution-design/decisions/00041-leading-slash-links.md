---
id: "00041"
title: "a link is a path with a leading slash, and the fixer follows nothing else"
status: accepted
date: 2026-09-08
tags: ["links", "fixer", "store"]
components: ["worker", "dashboard", "kiao-worker"]
paths: ["migrations"]
symbols: ["linkfix.go", "link-fix.js", "buildPathPattern", "storeLinkOf", "storePathOf", "V009__absolute-internal-links.js", "docTypeVersion", "absoluteOnly"]
triggers: ["rename rewrote prose", "bare path", "contents[].path", "V007", "relative markdown link", "template::", "unit::"]
supersedes: []
superseded_by: []
---

# 00041 — a link is a path with a leading slash, and the fixer follows nothing else

**Decision:** the leading slash is what makes a stored path a **link**. `linkfix.go` and its JS twin
`migrations/lib/link-fix.js` now require it — `buildPathPattern` opens with `/` instead of `/?` —
so a path token written without it is not a reference and is never rewritten. Everything that
*stores* one writes it that way: a unit's `contents[].path` (which was the last field that did not,
hence `docTypeVersion` 21 and `V009__absolute-internal-links.js`), a task's `settings.folder`,
and, as before, a sommaire's `members`, the `unit::` / `template::` schemes and every markdown
destination Dashboard writes. The conversion between the two forms is one pair of functions,
`storeLinkOf` / `storePathOf` in `kiao-worker/utils.ts`, mirrored by `storePathOf` in the Flutter
player and by `ResolvePath` on the wire, which has always taken either.

**Why: without the slash there is no telling a reference from prose.** A store's root folders are
called `docs`, `config`, `units` — ordinary words — so renaming one rewrote its name wherever it
stood: in a shell snippet, in a stack trace pasted into a note, in a sentence. The workaround
existed already and named the problem: `V001` had to ask for `absoluteOnly` for `config`, with the
comment that a bare `config/…` is a shell snippet as often as it is a link. Making it the rule
rather than an option is the whole fix, and `absoluteOnly` is gone.

**What it costs, and why that cost is the right one.** A reference written without the slash stops
being repaired. In markdown that is not a store link at all — `](../voisin.md)`, `](image.png)` are
read against the document that holds them, here as on GitHub and in an IDE preview, and prefixing
them would break them. In a JSON field it was one of the two shapes V009 converts. What is genuinely
given up is a bare path typed in prose, which was never distinguishable from prose in the first
place.

**V007 could not be corrected, so V009 repairs after it.** `V007__unit-folders-by-title.js` moves a
unit's folder and leaves the fixer to carry `contents[].path` across; those were written bare, so on
a store where V007 runs against this build the chain is left naming the old folder. Editing V007 is
not open to us — the runner compares an applied script's checksum and refuses to start on a mismatch
— so V009 re-points a slashless content path whose file is missing when a file of that name sits
beside the unit's own document. Both halves are read off the disk; a path that already carries the
slash is left exactly as it reads, whatever the filesystem says.

**Two conventions, and the boundary between them is explicit.** A *link* is what a document holds. A
*path* is what the wire, the router and `FileDto.path` speak. They meet at `storeLinkOf` /
`storePathOf` and nowhere else — which is why `defaultUnitDocPath` and `unitDocPathIn` still answer
with a bare path: they name where a file is written, not a reference held in one.
