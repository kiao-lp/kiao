# The provider stack (`src/App.tsx`)

> Part of the [Dashboard solution design](README.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

Rendered outermost → innermost. `MainApp` declares this stack as the ordered `APP_PROVIDERS`
array and nests it with a small local `composeProviders` helper; everything below is what a
plugin's `mainView` runs inside. The creation-plugin wrappers (marked ⟨creation⟩) are composed
from the plugin manifest by `CreationProviders` and sit between `ActivePluginProvider` and
the dispatchers — they are wrappers, not context providers, but occupy the same nesting.

| # | Provider | Provides |
| --- | --- | --- |
| — | `AuthProvider` (`react-oidc-context`) | OIDC auth — **skipped** when `VITE_NO_SECURITY==='true'`, so nothing below may assume it is mounted; the token is read through `useAuthToken` (see [Backend access](backend-access.md)). |
| 1 | `WorkerClientProvider` | The `WorkerClient` instance (backend access). |
| 1b | `ViewStateProvider` | Starts loading the remembered view state in parallel with configuration, with `waitForLoad={false}`. |
| 2 | `DashboardConfigProvider` | Resolved runtime feature flags (`chatEnabled`, `gitEnabled`) **and the list of plugins this store loads**. Blocks render until loaded. |
| 2b | `PluginAssemblyProvider` | Imports those plugins and holds their manifests. Blocks render until they are all in — the list below is built out of them. |
| 3 | `ViewStateReady` | Waits for the view state started above, so panes mount already restored. |
| 4 | `ThemeProvider` → `ThemeWrapper` (antd `ConfigProvider`) | Light/dark theme (`kiao-style` tokens). Sits below the view state, which is where the choice is stored. |
| — | `UnicodeKeyboard` | Global unicode-insertion helper (sibling, not a provider). |
| 5 | `BrowserRouter` | Routing, `basename` from `import.meta.env.BASE_URL` (see [Internal links](internal-links.md)). |
| 6 | `PluginListProvider` | The loaded plugin list + `findFilePlugin` + the pooled `customLinkRenderers` and `capabilities`. |
| 6b | `SecondaryDocumentProvider` | The file open in the second central area. |
| 7 | `PointedElementContextProvider` (`react-advanced-interactions`) | "Pointed" (hover/keyboard-focused) element tracking. |
| 8 | `SelectionProvider` | The cross-app selection model. |
| 9 | `ZoomTargetProvider` | Which element the magnifier is reading (see `zoom/`). |
| 10 | `HotkeyRegistryProvider` | Hotkey registry (see [commands-hotkeys.md](commands-hotkeys.md)). |
| 11 | `VoiceInputProvider` | Speech-to-text state for `cms-core/ui/VoiceInput`. |
| 12 | `AppRoutesFromPlugins` | Plugin pages (`/boards`, …), asked before file paths. |
| 13 | `FileBrowsingProvider` | File-browsing state (current file, list, persistence). |
| 14 | `ActivePluginProvider` | Resolves `{ activePlugin, activeFileConfig }` from current file. |
| ⟨creation⟩ | `CreationProviders` (each plugin's `CreationProvider`) + the core `FileTemplateCreationPlugin` just inside it | Register "New <type>" creation commands. |
| 16 | `HotkeyDispatcherProvider` | Dispatches keydown → matching hotkey. |
| 17 | Each plugin's `providers`, composed by `PluginProviders` | Whatever a plugin needs for the life of the app. Below the hotkey dispatcher so a provider may register hotkeys; above the tool bars so a panel consuming one is never its owner. |
| 18 | `ToolBarsProvider` | The tool bar tab registry, the open document's arrangement of them, and the columns' on/off + width. |
| 19 | `GitDiffProvider` | Current git diff target, and the working-tree pane's unsaved draft — what `LayoutContent`'s stack follower pushes the diff panel from. |
| 20 | `FileOptimizationsProvider` | Whether the file-optimizations view is up — the other application mode `LayoutContent` pushes onto the stack, and what the tools dropdown's entry switches on. |
| — | `ActivePluginGlobalProvider`, around `AppLayout` only | Applies the active plugin's optional `withGlobalProvider` to the document and the panels it renders. App providers and contributions remain its siblings or ancestors. |

Rows 5–20 are the `APP_PROVIDERS` array. Rows 1–4 stay explicit in `MainApp` because
`UnicodeKeyboard` is their sibling and `WorkerClientProvider` carries the request client. `PluginContributions` and `AppLayout` render as the innermost children.

The fixed stack establishes context availability. Plugin providers render their children while
their data loads; interfaces use `lazyComponent` for local loading and error boundaries. A pending
panel therefore leaves its providers and neighbouring panels mounted.

Changing the document's wrapper cannot remount the app providers or the Git monitor. The panels
inside `AppLayout` still inherit the active document's contexts, including the broad ones needed
by hotkeys and document-specific tools.
