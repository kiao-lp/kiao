---
id: "00037"
title: "`.kiao-files` bounds the walks that only read, and never the folder you named"
status: accepted
date: 2026-09-03
tags: ["store", "search", "scope"]
components: ["worker"]
paths: [".kiao-files"]
symbols: ["kiaoScopeAt", "/search", "/listRecursive", "skipMachineryDir", "[search]", "[migration]"]
triggers: ["slow search", "node_modules", "target/", "vendor/", "declared folder", "delete scope", "500 entries"]
supersedes: []
superseded_by: []
---

# 00037 — `.kiao-files` bounds the walks that only read, and never the folder you named

**Decision:** the store declaration takes a third concern, `[search]`, and it bounds the two passes
that read a tree wider than anyone aimed them — the `/search` walks (the index refresh and the
scan) and the `/listRecursive` walk that says what a delete would take with it. Patterns written
before any section bound it too, so a store that already declared its `node_modules` gets the
narrower search without editing anything. `skipMachineryDir` stays underneath as a floor: `.git`
and the state directory are excluded whatever a declaration says, because an empty declaration means
"exclude nothing" and those transcripts are not an operator's to hand over.

**Why the read-only passes need it at all.** The declaration was written for the passes that
*rewrite*, where the cost of an undeclared source tree is a restore from git. Search costs only
time — but a folder that is a network mount, or a `target/` holding a hundred thousand files, makes
`/search` at the root and `/listRecursive` on a parent unusable rather than slow, and neither can
work out on its own which folder that is. It is the same question, and the answer already lives in
the same file.

**Why named for search, when it also bounds a delete's scope.** An unknown section is parsed and
never consulted, so a wrong guess at the name fails silently — which makes discoverability the
deciding argument. An operator whose store has become slow looks for `[search]`, not for
`[traverse]`; the delete scope rides with it because it is the same walk into the same folder
nobody meant to include, and the docs say so where the sections are listed.

**A folder that is excluded is still walked when it is the folder that was named.** An exclusion
keeps a pass out of the folders nobody pointed it at, not out of the one that was pointed at — so a
search of a declared `vendor/` searches it, and a `/listRecursive` of it describes it in full. The
hard-coded floor already worked that way (`p != rootAbs`), and a rule that only moved the refusal
one level down would be worse than none: the operator would have declared a folder nobody can ever
look inside. It is implemented by dropping, for that one walk, the patterns that cover the folder
named (`kiaoScopeAt`), rather than by exempting a single path — a directory match covers everything
under it, so exempting the path alone would still refuse every entry in it. The rest of the same
declaration keeps applying inside.

**What it costs elsewhere.** Below the folder named, a declared directory is *listed* in a delete's
scope and not descended into: it goes with the delete, and the reader needs to see that it does,
while its forty thousand children are the part they could not read anyway. A declared *file* is not
searched at all, which with the seeded defaults means a dot-file is no more searched than a
dot-directory already was.
