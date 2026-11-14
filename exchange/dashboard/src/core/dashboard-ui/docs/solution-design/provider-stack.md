---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# The provider stack (`src/core/dashboard-ui/app/DashboardApp.tsx`)

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

[DashboardApp.tsx](../../app/DashboardApp.tsx) composes providers
outermost to innermost. Startup gates remain explicit in `DashboardApp`; the application
stack uses the ordered `APP_PROVIDERS` array. [App.tsx](../../../../App.tsx) selects the
authentication tree and supplies its worker client.

## Startup

| Order | Provider or gate | Purpose |
| --- | --- | --- |
| 1 | `AuthProvider` when secured | OIDC; absent in no-security mode, so use [useAuthToken](../../../auth/docs/solution-design/backend-access.md) |
| 2 | `WorkerClientProvider` | Request client |
| 3 | `ViewStateProvider` with `waitForLoad={false}` | Begin UI-state load alongside configuration |
| 4 | `DashboardConfigProvider` | Resolve flags and requested plugins |
| 5 | `PluginAssemblyProvider` | Load manifests before building their provider stack |
| 6 | `ViewStateReady` | Wait for saved UI state before interfaces mount |
| 7 | `ThemePreferences`, `ThemeWrapper` | Stored theme and antd configuration |

`UnicodeKeyboard` is a sibling of the composed application tree under the theme wrapper.

## Application stack

Each row nests inside the preceding row. Names below include the components used by the
router/registry wrappers in `APP_PROVIDERS`.

| Provider | Responsibility |
| --- | --- |
| `BrowserRouter` | Routing with Vite's base path |
| `PluginListProvider` | Resolution, renderers, extensions and capabilities |
| `SecondaryDocumentProvider` | Second file |
| `PointedElementContextProvider` | Hover/focus pointing |
| `SelectionProvider` | Cross-app selection |
| `ZoomTargetProvider` | Element magnifier target |
| `HotkeyRegistryProvider` | Key registration |
| `VoiceInputProvider` | Stored speech language through `VoiceInputPreferences` |
| `AppRoutesFromPlugins` | URL-prefix claims before file resolution |
| `FileBrowsingProvider` | Current file, listings and browsing state |
| `ActivePluginProvider` | Current plugin and file configuration |
| `CreationProviders` | Each manifest's creation wrapper |
| `FileTemplateCreationPlugin` | Core file-template creation commands |
| `HotkeyDispatcherProvider` | Match keys against live command context |
| `PluginProviders` | App-lifetime plugin state, in assembly order |
| `ToolBarsProvider` | Tab registry, placement, visibility and widths |
| `GitDiffProvider` | Diff target and working-tree draft |
| `ToolsMenuFromPlugins` | Enabled Tools menu contributions and connection to the layout stack |

Innermost siblings register internal navigation, core tabs and plugin contributions.
`ActivePluginGlobalProvider` wraps **`AppLayout` only**, applying the file configuration's
`withGlobalProvider`. Changing document types must not remount app providers, the Git monitor
or contributions. Panels rendered by the layout still inherit document contexts.

Provider order establishes context availability, not data-load completion. Plugin providers
render children while loading; heavy interfaces use `lazyComponent` for local loading and
error boundaries. See [runtime startup](../../../extensibility/docs/solution-design/plugins-runtime.md#startup).
