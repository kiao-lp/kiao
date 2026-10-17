# Internal links

> Detail of [ARCHITECTURE.md](../../../../exchange/dashboard/ARCHITECTURE.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

**A link to another document is stored bare — `/units/abc/cadre.md` — and resolved when it is
displayed.** Neither the domain nor the context path is ever written into a document, so moving the
app to another host or another mount point leaves every link already authored correct. The three
functions are [`lib/internal-links.ts`](../../../../exchange/dashboard/src/cms-core/lib/internal-links.ts), exported from the
barrel: `toStoredLink` on the way in, `resolveInternalLink` on the way out, and `internalPathOf`,
which answers the router path a href designates, or `null`.

The mount point is not configuration this code reads: it is `import.meta.env.BASE_URL`, the value
Vite was built with (`VITE_BASE_PATH`, default `/dashboard/`), so the app resolves against wherever
it is actually served. `App.tsx` derives the router `basename` and the OIDC `redirect_uri` from the
same value rather than restating it — the three drifting apart is a class of bug with no symptom
until deployment. The domain never appears at all: a root-relative href already means *this origin*.

Both ends are covered, and neither is a plugin's business:

- **In.** Anything that writes a link into a document passes it through `toStoredLink` — the
  markdown editor's paste handler, "Copy markdown link" in the tools menu, the mindmap's paste-link.
  An outside URL comes back untouched.
- **Out.** `ConfiguredMarkdown` applies `resolveInternalLink` to every anchor destination *past*
  the `prefix::` branch — a `template::` link
  belongs to template-edit's embed renderer, which resolves it itself, and must never be treated as a plain path.
- **Clicked.** [`files/navigation/InternalLinkNavigator.tsx`](../../../../exchange/dashboard/src/cms-core/files/navigation/InternalLinkNavigator.tsx),
  mounted once, turns a click on any anchor pointing inside the app into a router navigation. One
  listener covers the markdown renderer, the regex converter behind the diagram tooltips and any
  anchor a plugin writes by hand, instead of each of them having to reach for `<Link>`. It listens
  in the bubble phase and stands down on `defaultPrevented`, so a `<Link>` or a plugin's own
  `onClick` keeps its click.

**And the leading slash is what makes any of it work.** worker's `LinkFixer` recognises a link
by that slash and by nothing else, because a store's root folders are called `docs`, `config`,
`units` — ordinary words — so a bare `config/values` is a shell snippet as often as it is a
reference. Everything a document holds is therefore written with it: a flow node's
`settings.folder`, a bookmark's link, every destination `storedLinkOf` writes. A path *without* the
slash is a document-relative markdown link, read against the document holding it, and is left alone.
The pair that converts between a link and the bare path the wire speaks is `storeLinkOf` /
`storePathOf` in `kiao-worker/utils`; nothing does it by hand.

**Resolution is idempotent**: a stored link that already carries the mount point is returned as it
is. Existing stores were converted once by a file-store migration (since removed, the conversion
having run everywhere), so that is a safety net rather than the normal path — for a link arriving by
`git pull`, by an import, or from a clipboard older than the change. It also means such a link is
invisible to worker'
`LinkFixer`, which cannot repair it on a rename because the byte before the path is a `/` and so
not a token boundary ([`linkfix.go`](../../../../operation/worker/internal/files/linkfix.go)). A bare link is
repaired normally, which is the second thing the migration bought.
