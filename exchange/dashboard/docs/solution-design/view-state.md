---
status: DRAFT
role: PRIMARY_SOURCE
---

# View state (`src/cms-core/view-state/`)

Part of the [Dashboard solution design](README.md).

View state stores panes, tabs, zoom and scroll server-side, keyed by file path. It restores
the interface after navigation, reload and a full-page OIDC redirect. Ordinary token renewal
keeps `DashboardApp` mounted. Feature flags belong in `dashboard.json`, separate from UI state.

## Screen sizes

`viewStateDocFor` selects `dashboard-view-state-small.json` at viewport widths **≤768 px**
and `dashboard-view-state.json` above that, matching the CSS breakpoint. This prevents a
phone's column choices from overwriting the desktop layout.

The provider chooses once at mount. Resizing does not switch documents or reseed mounted
panes; the next page load selects the appropriate document.

### Config documents

Configuration uses `GET`/`PUT /config/{name}` in worker's state directory, by default
`<store-root>/.kiao-config`. The file API excludes this directory. The endpoint allowlists
document names and returns 404 for others, protecting adjacent migration and conversation state.

| File | Responsibility |
| --- | --- |
| [viewStateModel.ts](../../src/cms-core/view-state/viewStateModel.ts) | Shape, default merging, bounded file entries and cross-tab merges; no React |
| [ViewState-ctx.tsx](../../src/cms-core/view-state/ViewState-ctx.tsx) | Screen-size selection, loading and all writes |
| [useViewState.ts](../../src/cms-core/view-state/useViewState.ts) | File, folder and global scoped hooks |

```tsx
const [view, setView] = useFileViewState('pdf', { pageNumber: 1, zoom: 1 });
setView({ pageNumber: 4 }); // patch; stored values merge over defaults
```

Use one hook per scope key. Do not persist modes unsafe to reopen.

## Loading and persistence

- `DashboardApp` starts `ViewStateProvider` with `waitForLoad={false}` alongside configuration.
  `ViewStateReady` gates interfaces after plugin assembly so hooks see saved values at mount.
  Used alone, the provider gates its children by default.
- A missing document uses defaults. An unreadable document uses defaults **and disables writes**
  to avoid overwriting valid state after a backend failure.
- Writes debounce for **1.5 seconds**, flushing on file change, unmount and tab hiding.
  Unchanged state does not write.
- Before writing, reread and apply only scopes touched by this browser tab. Worker has no ETag;
  a blind PUT would discard other tabs' changes.
- Retain the **300 most recently accessed files** to bound document size.

`files[path].toolBars` holds per-file tab arrangement; `global.toolBars` holds visibility and
widths. See [tool bars](tool-bars.md). The shared scroller is the flex div in
[LayoutContent](../../src/cms-core/dashboard-ui/layout/LayoutContent.tsx); `window` does not scroll.

Browser storage holds content recovery buffers, not view preferences: unsaved editor snapshots
(`<plugin>.snapshot:<path>`), the conversation buffer and template KEL heap are per-tab crash
buffers. OIDC manages its own storage keys.
