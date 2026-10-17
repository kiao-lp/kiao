# View state (`src/cms-core/view-state/`)

> Detail of [ARCHITECTURE.md](../../../../exchange/dashboard/ARCHITECTURE.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

How the UI was left — which tab was in which tool bar, which panes were open, the zoom, where each
scroll container sat — is stored server-side in a view state config document, **keyed by file
path**,
so a file reopens exactly as it was closed: after a navigation, after F5, and after the full-page
OIDC redirect that a failed token renewal falls back to (`AuthenticatedApp` keeps `MainApp` mounted
across ordinary renewals, so that redirect is the only thing that really resets the app).

It is a separate document from `dashboard.json`: that one is hand-edited feature flags, this one is
rewritten by the app as you scroll. Neither lives in the file tree — see [*Config documents*](#config-documents) below.

**One document per screen size.** `viewStateDocFor` picks `dashboard-view-state-small.json` for a
viewport of 768 px or less and `dashboard-view-state.json` above it. What is stored here *is* the
layout, and the same store is browsed from a phone and from a desktop: a phone has room for one
column and closes the rest, which in a shared document closed them on the desktop too. 768 px is
the breakpoint the stylesheets lay out for, so the document and the layout it describes agree — a
desktop window dragged narrow is a small screen by both. The provider reads the width once, when it
mounts, and keeps that document for the session; switching on a resize would re-seed every mounted
pane from a document it has never read, and the next load picks up the right one anyway.

### Config documents

Both are read and written through `GET`/`PUT /config/{name}`, which worker serves from its
own state directory (`<store-root>/.kiao-config` by default), **not** from the managed file tree:
that directory sits in the root but the file API refuses every path into it and lists none of it.
They used to be two files in the store, fetched with `getFileJson`, which put machine configuration
in the file browser, in `git status` and in anything the user published. The name is one worker
allow-lists; anything else is a 404, so the endpoint can never reach the migration ledger or the
conversation registry sitting beside them.

| Piece | Role |
| --- | --- |
| [`viewStateModel.ts`](../../../../exchange/dashboard/src/cms-core/view-state/viewStateModel.ts) | The document's shape and the pure operations over it — scope reads merged over defaults, LRU pruning at `MAX_FILE_ENTRIES`, cross-tab merging. No React. |
| [`ViewState-ctx.tsx`](../../../../exchange/dashboard/src/cms-core/view-state/ViewState-ctx.tsx) | Picks the document for this screen size, loads it once, and owns every write to it. |
| [`useViewState.ts`](../../../../exchange/dashboard/src/cms-core/view-state/useViewState.ts) | `useFileViewState` / `useFolderViewState` / `useGlobalViewState`. |
| [`useScrollMemory.ts`](../../../../exchange/dashboard/src/cms-core/view-state/useScrollMemory.ts) | `useScrollMemory` for DOM scrollers, `useCodeMirrorScrollMemory` for CodeMirror panes. |

A plugin remembers something in two lines, `useState`-shaped and namespaced by a scope key:

```tsx
const [view, setView] = useFileViewState('pdf', { pageNumber: 1, zoom: 1.0 });
setView({ pageNumber: 4 });
```

Load and write behaviour, and why:

- **Blocks render until loaded**, like `DashboardConfigProvider`. That is what lets a pane seed its
  `useState` from the stored value in the tick it mounts, instead of painting the default first.
- **Missing document** → seeded with defaults. **Unreadable document** → runs on defaults *and
  disables writing*, so a backend hiccup can never overwrite good state.
- **Debounced 1.5 s**, flushed on file change, on unmount, and when the tab is hidden.
- **No-op writes are skipped** and offsets are rounded (pixels to integers, CodeMirror lines to two
  decimals): idle jitter must not cost a write.
- **Re-read before write**, applying only the scopes this tab touched. Unit content opens in new
  *browser* tabs and worker has no ETag, so a blind PUT would discard another tab's work.
- **Pruned to the 300 most recently accessed files**, so the document stays bounded.

The `toolBars` scope is the one that is both per file and app-wide, and deliberately so: the
arrangement of the tabs is the document's (`files[path].toolBars`), while whether a column is
switched on and how wide it is describes the window (`global.toolBars`). See *Tool bars*.

Two scroll notes. `window` never scrolls (`#ui-root { overflow: hidden }`); the shared scroller is
the flex div in [`LayoutContent`](../../../../exchange/dashboard/src/cms-core/core/LayoutContent.tsx), which every plugin without
one of its own inherits for free. And restoration re-applies the offset under a frame loop until the
content is tall enough to hold it — content arrives after mount — giving up after 2 s or the moment
the user scrolls, whichever comes first.

Nothing UI-related is left in `localStorage`/`sessionStorage`. What deliberately stays there is not
view state: an editor's unsaved-document rescue snapshot (`<plugin>.snapshot:<path>`), the agent
conversation buffer, and the template KEL heap are per-tab crash buffers holding document content,
which must not be committed; `oidc-client-ts` owns its own keys.
