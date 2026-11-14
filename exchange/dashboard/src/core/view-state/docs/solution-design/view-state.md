---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# View state (`src/core/view-state/`)

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

View state stores global preferences, folder views and file-specific plugin settings server-side.
It restores the interface after navigation, reload and a full-page OIDC redirect. Toolbar
placement and selection are global for each screen size. Ordinary token renewal keeps
`DashboardApp` mounted.
Feature flags belong in `dashboard.json`, separate from UI state.

## Screen sizes

`viewStateDocFor` selects `dashboard-view-state-small.json` at viewport widths **≤768 px**
and `dashboard-view-state.json` above that, matching the CSS breakpoint. Desktop and
small-screen layouts have independent state.

The provider selects its document at mount and keeps it for its lifetime. Each page load
selects the document for the viewport width at that time.

### Config documents

View state uses worker's [config-document contract](/operation/worker/PROTOCOL/config-documents.md)
for storage, allowed names and validation. This component owns screen-size selection and persistence.

| File | Responsibility |
| --- | --- |
| [viewStateModel.ts](../../viewStateModel.ts) | Pure model, default merging, bounded file entries and cross-tab merges |
| [ViewState-ctx.tsx](../../ViewState-ctx.tsx) | Screen-size selection, loading and all writes |
| [useViewState.ts](../../useViewState.ts) | File, folder and global scoped hooks |

```tsx
const [view, setView] = useFileViewState('pdf', { pageNumber: 1, zoom: 1 });
setView({ pageNumber: 4 }); // patch; stored values merge over defaults
```

Use one hook per scope key. Persist modes that are safe to reopen.

## Loading and persistence

- `DashboardApp` starts `ViewStateProvider` with `waitForLoad={false}` alongside configuration.
  `ViewStateReady` gates interfaces after plugin assembly so hooks see saved values at mount.
  Used alone, the provider gates its children by default.
- A missing document uses defaults. An unreadable document uses defaults **and disables writes**
  to avoid overwriting valid state after a backend failure.
- Writes debounce for **1.5 seconds**, flushing on unmount, page unload and tab hiding.
  Changes to a scope schedule a write.
- Before writing, reread the server document and apply this browser tab's dirty scopes,
  preserving updates from other tabs.
- Retain the **300 most recently accessed files** to bound document size.

`global.toolBars` holds tab placement and selection, area visibility, central-area configuration
and side widths. File entries hold plugin settings such as panes and zoom.
See [tool bars](../../../dashboard-ui/docs/solution-design/tool-bars.md).

Browser storage holds content recovery buffers: unsaved editor snapshots
(`<plugin>.snapshot:<path>`), the conversation buffer and template KEL heap are per-tab crash
buffers. OIDC manages its own storage keys.
