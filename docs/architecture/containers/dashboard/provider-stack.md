# The provider stack (`src/App.tsx`)

> Detail of [ARCHITECTURE.md](../../../../exchange/dashboard/ARCHITECTURE.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

Rendered outermost → innermost. `MainApp` declares this stack as the ordered `APP_PROVIDERS`
array and nests it with a small local `composeProviders` helper; everything below is what a
plugin's `mainView` runs inside. The creation-plugin wrappers (marked ⟨creation⟩) are composed
from the plugin manifest by `CreationProviders` and sit between `SideDocumentsProvider` and
the dispatchers — they are wrappers, not context providers, but occupy the same nesting.

| # | Provider | Provides |
| --- | --- | --- |
| — | `AuthProvider` (`react-oidc-context`) | OIDC auth — **skipped** when `VITE_NO_SECURITY==='true'`, so nothing below may assume it is mounted; the token is read through `useAuthToken` (see [Backend access](backend-access.md)). |
| 1 | `WorkerClientProvider` | The `WorkerClient` instance (backend access). |
| 2 | `DashboardConfigProvider` | Resolved runtime feature flags (`chatEnabled`, `gitEnabled`) **and the list of plugins this store loads**. Blocks render until loaded. |
| 2b | `PluginAssemblyProvider` | Imports those plugins and holds their manifests. Blocks render until they are all in — the list below is built out of them. |
| 3 | `ViewStateProvider` | The remembered view state. Blocks render until loaded, so panes mount already restored. |
| 4 | `ThemeProvider` → `ThemeWrapper` (antd `ConfigProvider`) | Light/dark theme (`kiao-style` tokens). Sits below the view state, which is where the choice is stored. |
| — | `UnicodeKeyboard` | Global unicode-insertion helper (sibling, not a provider). |
| 5 | `BrowserRouter` | Routing, `basename` from `import.meta.env.BASE_URL` (see [Internal links](internal-links.md)). |
| 6 | `PluginListProvider` | The loaded plugin list + `findFilePlugin` + the pooled `customLinkRenderers`, `sideDocuments` and `capabilities`. |
| 7 | `PointedElementContextProvider` (`react-advanced-interactions`) | "Pointed" (hover/keyboard-focused) element tracking. |
| 8 | `SelectionProvider` | The cross-app selection model. |
| 9 | `ZoomTargetProvider` | Which element the magnifier is reading (see `zoom/`). |
| 10 | `CommandRegistryProvider` | Command registry (see [commands-hotkeys.md](commands-hotkeys.md)). |
| 11 | `HotkeyRegistryProvider` | Hotkey registry. |
| 12 | `VoiceInputProvider` | Speech-to-text state for `cms-core/ui/VoiceInput`. |
| 13 | `AppRoutesFromPlugins` | Plugin pages (`/boards`, …), asked before file paths. |
| 14 | `FileBrowsingProvider` | File-browsing state (current file, list, persistence). |
| 15 | `ActivePluginProvider` | Resolves `{ activePlugin, activeFileConfig }` from current file. |
| 16 | `ActivePluginGlobalProvider` | Applies the active plugin's optional `withGlobalProvider`. |
| 17 | `SideDocumentsProvider` | The side documents shown beside the open document. |
| ⟨creation⟩ | `CreationProviders` (each plugin's `CreationProvider`) + the core `FileTemplateCreationPlugin` just inside it | Register "New <type>" creation commands. |
| 18 | `HotkeyDispatcherProvider` | Dispatches keydown → matching hotkey. |
| 19 | `CommandDispatcherProvider` | Executes commands (builds `CommandContext`). |
| 20 | Each plugin's `providers`, composed by `PluginProviders` | Whatever a plugin needs for the life of the app. Below the dispatchers so a provider may register commands; above the tool bars so a panel consuming one is never its owner. |
| 21 | `ToolBarsProvider` | The tool bar tab registry, the open document's arrangement of them, and the columns' on/off + width. |
| 22 | `GitDiffProvider` | Current git diff target, and the working-tree pane's unsaved draft — what `LayoutContent`'s stack follower pushes the diff panel from. |
| 23 | `FileOptimizationsProvider` | Whether the file-optimizations view is up — the other application mode `LayoutContent` pushes onto the stack, and what the tools dropdown's entry switches on. |

Rows 5–23 are the `APP_PROVIDERS` array. Rows 1–4 stay explicit in `MainApp` because
`UnicodeKeyboard` is their sibling and `WorkerClientProvider` carries the request client. `PluginContributions` and `AppLayout` render as the innermost children.
