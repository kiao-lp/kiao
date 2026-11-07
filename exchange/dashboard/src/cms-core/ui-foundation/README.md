---
status: DRAFT
role: PRIMARY_SOURCE
---

# UI foundation

Reusable UI components and interaction helpers live here, including those used only by a
plugin. They depend on their siblings and UI libraries, without Dashboard services, file
models, plugin capabilities or store access. Component styles live beside their components.

| Folder | Provides |
| --- | --- |
| `clipboard/` | Copy text, HTML and SVG/PNG controls and SVG clipboard support |
| `code-editor/` | [Text, code and JSON editors](code-editor/README.md), [text comparison](code-editor/comparison.md) and editor scrolling |
| `feedback/` | Viewport-aware tooltips, retryable error boundaries and progress feedback |
| `forms/` | Form fields, key/value editing and confirmation dialogs |
| `interactions/` | Selection, pointing, pointer tracking, long press, hover and menu placement |
| `language/` | Language flags, language selection and default language names |
| `layout/` | Weighted split panes, resize handles, vertical labels and row-list styles |
| `media/` | Asynchronous images, image previews and SVG rendering |
| `navigation/` | Page navigation with a draft page number |
| `react/` | Context helpers and lazy components with local loading/error handling |
| `reorder/` | Pointer and keyboard list reordering |
| `scrolling/` | Following growing content until the reader scrolls away |
| `styles/` | CSS injection |
| `text-input/` | Unicode keyboard and highlighting by character range |
| `theme/` | Theme context and document theme attribute |
| `toolbar/` | Toolbar buttons and SVG icons |
| `voice-input/` | Speech-enabled inputs and spoken punctuation formatting |
| `zoom/` | Zoom controls, Ctrl-wheel zoom and element magnification |

Dashboard plugins and kit modules import these widgets through `@cms-core`. Existing
`@cms-kit/components`, `@cms-kit/code-editor`, `@cms-kit/reorder` and
`@cms-kit/zoom-control` entry points remain aliases to the same implementations.
`react-concise` and `react-advanced-interactions` also keep their shared context identity.

For reuse in another application, import the relevant module or [index.ts](index.ts).
The theme uses the `kiao-style` theme vocabulary and CSS tokens. Controls also use React,
Ant Design and, where relevant, CodeMirror or browser speech recognition. Language selection
accepts its own language codes and names; clipboard controls accept their own labels and CSS
classes. `data-zoom-controls` marks a control bar that magnification must leave visible.

## State ownership

The foundation's `ThemeProvider`, `VoiceInputProvider` and `SplitRow` keep local state by
default. A caller can control them with `theme`/`onThemeChange`,
`language`/`onLanguageChange` and `weights`/`onWeightsChange`, respectively.

Dashboard persists these values through adapters in `cms-core/dashboard-ui/preferences/`:
`ThemePreferences`, `VoiceInputPreferences` and `PersistentSplitRow`. The `@cms-core`
facade's `VoiceInputProvider` and `SplitRow` use these adapters, keeping the stored keys
`voiceLanguage`, `theme` and `split:<id>`. The foundation itself has no persistence dependency.

The application shell lives in [dashboard-ui](../dashboard-ui/README.md): layout, document
panels, toolbars and application controls. File and navigation views, Git, Configuration,
Markdown rendering, boards and conversations stay with their feature modules. Format engines
and their editors remain in the kit or their plugin; their generic controls belong here.
