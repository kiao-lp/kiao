---
id: "00010"
title: "V017 matches links on a token boundary, not on a substring"
status: accepted
date: 2026-08-15
tags: ["links", "migrations"]
components: ["migrations"]
paths: ["migrations"]
symbols: ["V017__portable_internal_links.js", "files/linkfix.go"]
triggers: ["migration rewrite", "substring replace", "assets/", "stack trace in note", "shell snippet rewritten"]
supersedes: []
superseded_by: []
---

# 00010 — V017 matches links on a token boundary, not on a substring

**Decision:** the migration that stripped `/dashboard` from the store requires the prefix to start
at a token boundary — the same rule as `files/linkfix.go` — and excludes `assets/` by name. **Why:** the
store's 34 occurrences of `/dashboard/` were not 34 links. Six were `exchange/dashboard/src/...` in
`config/values/kiao.json`, paths into the *kiao-pub repository* that merely contain the string;
three more were the same thing in notes; two were `http://localhost:50302/dashboard/`, a development
instance, i.e. another origin; three were a stack trace pasted into a note
(`at L1t.runAction (/dashboard/assets/index-….js:777:12097)`). A substring replace would have
corrupted all fourteen. The boundary rule rejects the first eleven for free — the preceding byte is
a letter or a digit — and `assets/` is the one exception that needs naming, being the built SPA's
own directory and never store content. 19 links in 7 files were rewritten; the 5 whose target does
not exist were already dangling beforehand, the migration having only removed a prefix.
