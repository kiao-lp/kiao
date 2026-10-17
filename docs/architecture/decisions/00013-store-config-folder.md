---
id: "00013"
title: "the store's own configuration folder is `kiao-user-config`, not `config`"
status: accepted
date: 2026-08-24
tags: ["store", "config", "migrations"]
components: ["dashboard", "migrations"]
paths: ["kiao-user-config"]
symbols: ["V001__rename-root-folders.js", "link-fix.js", ".kiao-files"]
triggers: ["new root folder", "config/", "value providers", "file templates", "rename a folder", "absoluteOnly"]
supersedes: []
superseded_by: []
---

# 00013 — the store's own configuration folder is `kiao-user-config`, not `config`

**Decision:** the folder Dashboard reads a store's value providers, file templates and CV/cursus
pools from is `kiao-user-config/`, and `qd-notes/` — the notes tree of the personal store — is
`docs/`. Both are moved by [`V001__rename-root-folders.js`](../../migrations/V001__rename-root-folders.js),
which rewrites the links into them as it goes. **Why:** `config` is a name a store does not own.
DCMS serves any folder, and a source repository is the ordinary case, not the exotic one — kiao-pub
is itself the default store root of `bin/local-start-kiao.sh`, and its `config/` holds the
deployment environments, nothing Dashboard should be listing as value providers. There is no way to
tell the two apart from inside the app, so the app's folder is the one that had to move, to a name
nothing else claims. `docs` is the opposite trade and worth naming as such: it is a *common* name,
deliberately, because that tree is documents and `qd-notes` said nothing to anyone who had not been
told. A store that already has a `docs/` is left alone with a warning rather than merged.

**What the migration will and will not touch.** Both the rename and the link pass are bounded by
`.kiao-files` for the `[migration]` concern, which is what keeps this off kiao-pub's own `config/`
— the checkout declares `/` there. Links are rewritten by
[`lib/link-fix.js`](../../migrations/lib/link-fix.js), the JS twin of `files/linkfix.go`, so a
link moved by the migration and one moved by a rename in the UI come out identical. `config` is
matched **only with a leading slash**, the form `toStoredLink` writes: unanchored, `config/values`
is a shell snippet as often as a link. `qd-notes` is matched either way, and the rehearsal on the
real store showed why that is right — 27 substitutions in 13 files, most of them prose references
rather than markdown links, and the one bad rewrite was a backlog heading that had the words
"rename qd-notes" in it. That is exactly what the interactive rename would have done too.
