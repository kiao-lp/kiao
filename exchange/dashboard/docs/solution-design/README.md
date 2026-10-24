# Dashboard solution design

Dashboard is the React/Vite CMS content providers use to author KIAO content. It is a
**file-oriented, plugin-based** single-page app: the backend ([`worker`](../../../../operation/worker/README.md))
exposes a managed file tree, and Dashboard renders/edits each file with the plugin that claims its
file type. This file is the map: the zones, the subsystems and the plugins. Each topic below
links to its detail file under
[`exchange/dashboard/docs/solution-design/`](./) —
read the map, then only what the task needs.

The [central solution design index](/docs/solution-design/README.md) links to
cross-container designs. Companion usage and reference pages remain in the per-plugin
`README.md` files under `src/plugins/`.

## Three source zones

```
src/cms-core/   — the framework: file browsing, plugin resolution, commands/hotkeys,
                  selection, tool bars, top-banner, config, and the input widgets it draws
                  its own chrome with. Exposed through one façade, `@cms-core`.
src/plugins/    — one folder per file type (markdown-edit, mindmap-edit,
                  archdia-edit, hybridflow-ui, …). Each is a CmsPlugin. A plugin that is
                  not delivered with Dashboard is the same thing in a project of its
                  own — see "Plugins that are not delivered" below.
src/kit/        — the shared kit: what plugins share with *each other* and cms-core does not
                  use — the markdown editor body, drag-to-reorder, the diagram kits,
                  the TTS voice catalogue, the format contracts, the template-lang
                  template engine. One façade per module, `@cms-kit/<module>`.
```

**Three zones, one direction: `plugins → kit → cms-core`.**

* A plugin imports `@cms-core` and `@cms-kit/<module>`, and never a file inside either — the two
  façades are the whole of what a plugin may see.
* A kit module may import `@cms-core`. **Nothing in cms-core imports the kit**: what cms-core uses
  is cms-core's, and it says so by exporting it.
* `cms-core` never imports from `plugins` — not a line. A plugin reaches the framework only by
  what it *declares* in its manifest (see *The plugin contract*).

The kit is a façade per module rather than one barrel, because one barrel would put the whole kit
— CodeMirror, mermaid, the template engine — behind an import of a four-line helper, and would
make any module added to it a dependency of every test that touches any other. The alias list in
`tsconfig.paths.json` names each entry point explicitly and has **no wildcard**, so there is still
no way to reach a file inside a kit module.

### cms-core subsystems

| Folder | Owns |
| --- | --- |
| `core/` | The plugin contract and active-plugin resolution (see below). |
| `files/` | File browsing: `browser/` (FolderBrowser, split into `folderBrowserRows.tsx` / `folderBrowserColumns.tsx` + the `useFolderRowProps` / `useRowInteractions` / `useLongPress` hooks), `core/` (browsing state, persistence, current-file; file mutations in `useFileOperations.ts`), `service/` (WorkerClient wiring), `disk-sync/` (reading, saving and following an open file — as text or as a parsed document), `selection/`, `clipboard/`, `context-menu/`, `actions/` (server-declared file actions), `dnd/` (what a dragged row carries, and the boxes that take it), `nav-bar/`, `navigation/`, `view-mode/`, `creation/`. |
| `commands/` | Command & hotkey registry + dispatchers (see [commands-hotkeys.md](commands-hotkeys.md)). |
| `selection/` | Cross-app selection model and pointing (`selection/pointing/`). |
| `tool-bars/` | Where every panel is drawn: the top bar and the three columns below it — the middle one holding the document — and which tab the open document puts in each (see [tool-bars.md](tool-bars.md)). |
| `toolbar/` | The Git suite — the panel, the diff mode and the sync monitor (see [panel-suites.md](panel-suites.md)). |
| `secondary-document/` | A second file shown in the second central area, opened with `useSecondaryDocument().open(file)` — the mindmap a markdown file opens from its toolbar. |
| `split/` | The central area divided into parts the reader drags the width of — the markdown source beside its preview (see [split.md](split.md)). |
| `top-banner/` | The top bar: the two column switches, the **Show** menu that arranges the tool bars, language/theme switches, unicode palette, disk usage, tools dropdown, command sentence, and the zoom slider when something is selected. |
| `zoom/` | The magnifier: Ctrl-click an element to read it larger — or, where there is no Ctrl key, hold a finger on it for half a second, which picks it the same way and keeps the platform's own callout off the gesture. It opens at 125% and the banner's slider takes it anywhere from 100 to 200%, Escape puts it back. What is then too large for the window scrolls inside itself. Any element marked with the exported `zoomable` prop object is a target, as is any fenced markdown block — which is how a rendered diagram is one. One element at a time, and always over the page: this is not the same thing as the size a whole pane is read at, which each pane owns (see [preview-size.md](preview-size.md)). |
| `config/` | `DashboardConfig` runtime feature flags. |
| `toolbox/` | The configuration panel: what is installed on the machine worker runs on, and which MCP servers an agent's turn is handed (see [configuration-panel.md](configuration-panel.md)). |
| `file-optimizations/` | What the store is carrying that it need not be — the files stored more than once, and the biggest ones — in a view that takes the central area over (see [file-optimizations.md](file-optimizations.md)). |
| `view-state/` | How the UI was left — panes, tabs, zoom — remembered per file (see [view-state.md](view-state.md)). |
| `markdown/` | `ConfiguredMarkdown` — the shared markdown renderer wired with plugin link renderers. |
| `text-fragment/` | A passage of a document named by the words it is made of, carried in a URL — the WICG text-directive grammar, resolved and highlighted in the preview, and written back from a right-click on a selection (see [passage-links.md](passage-links.md)). |
| `ui/` | The input widgets cms-core draws its own chrome with, and offers plugins through the façade: `VoiceInput/` (a field the user may dictate into — the rename modal and the file search use one), `codemirror/` (the plain-text editing surface, and where a CodeMirror view is scrolled to), `components/KiaoFlag`, `Tooltip` (Ant Design's, told to slide back inside the window rather than hang over its edge — every tooltip in the app comes from here and none from `antd`, which is what makes the rule one place instead of forty). Anything only plugins use is not here; it is in the kit. |
| `lib/` | `clipboard`, `internal-links`, `internal-navigation`, and the vendored `react-concise` / `react-advanced-interactions` helpers. |
| `app-routes/` | Plugin pages that are not files — `/boards` and the like — resolved before file paths. |
| `auth/` | The one place the OIDC session is read from outside `App.tsx` (see [backend-access.md](backend-access.md)). |

## The plugin contract

> [`plugins-runtime.md`](plugins-runtime.md).
> The interface itself is
> [`src/cms-core/core/FileBasedPlugin.ts`](../../src/cms-core/core/FileBasedPlugin.ts).

### The assembly: what is shipped, and what is loaded

> [`plugins-assembly.md`](plugins-assembly.md).

### Plugins that are not delivered

> [`plugins-assembly.md`](plugins-assembly.md)
> (the mechanism — a plugin project dropped in as `VITE_PLUGIN_PATHS`),
> and the `dashboard-plugin` skill
> ([`/.agents/skills/dashboard-plugin/SKILL.md`](../../../../.agents/skills/dashboard-plugin/SKILL.md),
> §8) for writing one.

### The plugins today ([`src/plugins/catalogue.json`](../../src/plugins/catalogue.json))

The catalogue is the one file that lists them: id, title and the sentence the Configuration panel
shows. The id is the folder name and the entry point is `src/plugins/<id>/index.tsx`, by convention
and without exception.

| Plugin (module) | `src/plugins/…` | Claims |
| --- | --- | --- |
| FolderBrowser | `cms-core/files/browser` | directories (`file.isDirectory`) |
| FeatMatViewer | `plugins/featmat-view` | `.fmat.json` |
| GraphEditor | `plugins/graph-edit` | `.graph.json` |
| MindmapEditor | `plugins/mindmap-edit` | `.mmap.json` |
| Templates | `plugins/template-edit` | `.temp.md` |
| SecuredImageViewer | `plugins/image-view` | `.jpg .jpeg .png .gif .webp` (one of its folder's pictures: stepped through and deleted from the banner — see [`plugins/image-view/README.md`](../../src/plugins/image-view/README.md)) |
| SvgEditor | `plugins/svg-edit` | `.svg`, drawn on a canvas (shapes moved, resized and styled) and edited as source (see [`plugins/svg-edit/README.md`](../../src/plugins/svg-edit/README.md)) |
| EpubViewer | `plugins/epub-view` | `.epub` |
| PdfViewer | `plugins/pdf-view` | `.pdf` |
| MovieEditor | `plugins/movie-edit` | `.mp4 .webm .mov .mkv` and recordings (`.mp3 .m4a .wav .ogg`): played, stepped image by image and key image by key image, and cut into named segments kept in a sidecar beside the file (see [`plugins/movie-edit/README.md`](../../src/plugins/movie-edit/README.md)) |
| ModelViewer | `plugins/three-d-model-view` | `.glb`, on a stage with an inspector (see [`plugins/three-d-model-view/README.md`](../../src/plugins/three-d-model-view/README.md)) |
| ArchDiaEditor | `plugins/archdia-edit` | `.arch.md` |
| TtstEditor | `plugins/ttst-edit` | `.ttst.md` (reads a `.ttst.md.config.json` sidecar; see below) |
| ActivityLog | `plugins/activity-log` | `YYYY-MM-DD.actlog.jsonl` (time entries per project, recorded from the Activity tab — see [`plugins/activity-log/README.md`](../../src/plugins/activity-log/README.md)) |
| Hybridflow | `plugins/hybridflow-ui` | no file type: boards are rows in `hybridflow-store`, drawn under the `/boards` URL prefix (one canvas of flow nodes, each with a UUID; see [`plugins/hybridflow-ui/README.md`](../../src/plugins/hybridflow-ui/README.md)) |
| MarkdownEditor | `plugins/markdown-edit` | `.md`, `.src.md` included (see [static-versions.md](static-versions.md)) |
| CodeEditor | `plugins/code-edit` | `.json .sh .bash`, configuration (`.xml .yml .yaml .properties .gitignore`), and source files: `.ts .tsx .mts .cts .js .jsx .mjs .cjs .java .rs .go .py .kt .kts .sql`, and the Go module files (`go.mod go.sum go.work go.work.sum`) — all generic, so it declares `fallback: true`. A source file keeps its extension in its label — `index.ts` and `index.tsx` are two files, not one name twice |
| TextEditor | `plugins/text-edit` | `.txt .jsonl .cls`, plus the store's `.kiao-files` marker; generic too, so `fallback: true` |

`plugins/chat`, `plugins/bookmarks` and `plugins/tags` are in the catalogue too: they
claim no file type (`fileConfigFor` returns `null`) and exist only to contribute their tool bar tab
— the chat; the store's bookmarks (`kiao-user-config/bookmarks.json`, a title, a link and a
note per bookmark; see [`plugins/bookmarks/README.md`](../../src/plugins/bookmarks/README.md)); and the store's
tags (`kiao-user-config/tags.json`, a label and a colour per tag; see
[`plugins/tags/README.md`](../../src/plugins/tags/README.md)). Git remains a cms-core integration because
it owns the app-level diff mode.

**Tags are a word, not an id.** A document that carries them carries the words themselves (`"tags":
["bug", "ui"]` on a board's flow node), and `tags.json` says only what colour each word is worn in —
a word it does not name is still worn, in grey. That is what keeps a document hand-writable,
writable by an agent's turn with no second file to consult, and meaningful when a card is pasted
into another instance of KIAO. `hybridflow-ui` is the first document type to wear them, and nothing
about the format is the board's: the next one needs `TagPicker` and `TagChips` and nothing else.

**A sidecar is deliberately unclaimed.** `*.ttst.md.config.json` is read and written by
`ttst-edit`, which registers no matcher for it: opened on its own the file means nothing without
its script, and `code-edit` renders it perfectly well as raw JSON. This is an intentional omission,
not a gap to fill — and it is the choice `movie-edit` makes for the `<video>.config.json`
a video's segments are kept in.

### Capabilities — what one plugin offers another (`src/kit/capabilities/`)

> [`plugins-runtime.md`](plugins-runtime.md)
> (the rule and the ownership) and the `dashboard-plugin` skill
> ([`/.agents/skills/dashboard-plugin/SKILL.md`](../../../../.agents/skills/dashboard-plugin/SKILL.md),
> §6) for offering and asking.

### Secondary document (`src/cms-core/secondary-document/`)

A plugin opens a second file with `useSecondaryDocument().open(file)` from `@cms-core`.
It is shown in the second central area. `close()` clears it.

### Adding a plugin

> Writing a plugin is the `dashboard-plugin` skill —
> [`/.agents/skills/dashboard-plugin/SKILL.md`](../../../../.agents/skills/dashboard-plugin/SKILL.md)
> (discovery entry in `.claude/skills/`).

## Details

| Topic | In brief |
| --- | --- |
| [Tool bars](tool-bars.md) | Left, central and right areas of placeable tabs; arrangement per document, switches app-wide. |
| [The file tree](file-navigators.md) | The file tree as a placeable tab; state, refresh, reveal. |
| [Dragging a file out of the store](file-drag-drop.md) | Dragging store rows out: mime flavours, drop targets, link writing. |
| [Uploading, and the review it opens](upload-review.md) | Uploads land in a hidden staging area, then a Delete/Import review dialog. |
| [The import gate](import-gate.md) | Secret scanning of readable uploads, with redaction before import. |
| [The central area](central-area.md) | The document panel, its stack, and addressability. |
| [Folder index](folder-index.md) | A folder holding an Index file opens it instead of its listing. |
| [Internal links](internal-links.md) | Bare stored links, mount-point resolution, click interception. |
| [Linking to a passage](passage-links.md) | Passage links (`#text=`): grammar, matching, highlight, copy. |
| [Image links](image-links.md) | Document-relative image sources joined onto the document folder. |
| [The markdown preview's size](preview-size.md) | Per-file preview zoom via CSS zoom, anchor-preserving. |
| [A divided centre](split.md) | Draggable weighted divisions of the central area. |
| [Saving](saving.md) | Autosave-as-you-type rules every editor follows. |
| [Following the file on disk](disk-sync.md) | Watching the open file: polling, conflicts, codec merges. |
| [The provider stack](provider-stack.md) | The App.tsx provider tree, outermost to innermost. |
| [Hotkey system](commands-hotkeys.md) | Declarative hotkeys: registration, context and dispatch. |
| [Server file actions](server-actions.md) | Server-declared file operations as context-menu entries. |
| [The configuration panel](configuration-panel.md) | The package-manager panel: runtimes, MCP servers, plugins. |
| [File optimizations](file-optimizations.md) | Duplicate consolidation and big-file reporting. |
| [Static versions](static-versions.md) | Self-contained .md generated from .src.md with baked diagrams. |
| [Panel suites](panel-suites.md) | The Git panel and the chat panel. |
| [Row lists](row-lists.md) | Zebra striping and width rules for row lists. |
| [Reordering](reordering.md) | Drag-to-reorder lists via the kit hook. |
| [Path aliases](path-aliases.md) | The tsconfig/Vite alias map and its rules. |
| [Backend access](backend-access.md) | The kiao-worker client, auth wiring, token reading. |
| [Runtime configuration](runtime-config.md) | dashboard.json flags and plugin-list resolution. |
| [View state](view-state.md) | Per-file persisted UI state and config documents. |
| [Entry point](entry-point.md) | index.tsx, theme bootstrap, web app manifest. |
| [Board UI](board-ui.md) | Board URLs, gestures, identifiers, merging and browser state. |
| [ArchDia plugin internals](plugins/archdia-edit.md) | Parser, storage and render models, state and SVG rendering. |
| [Extending ArchDia](plugins/archdia-extending.md) | Adding a diagram-language extractor and selecting it in the state hook. |

## Decision records

Dashboard-only records live in [decisions](./decisions). The
[shared decision index](/docs/solution-design/decisions/README.md) links to each
record and to the global records for cross-container contracts.
