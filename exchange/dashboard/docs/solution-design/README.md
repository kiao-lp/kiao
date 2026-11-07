---
status: DRAFT
role: PRIMARY_SOURCE
---

# Dashboard solution design

Use this index to locate the code and read only the relevant design. Cross-container
contracts belong in the [central solution design index](/docs/solution-design/README.md).
Plugin usage and API references stay in [local guides](../../src/plugins/README.md).

## Three source zones

| Zone | Owns | Public imports |
| --- | --- | --- |
| `src/cms-core/` | Application framework, browsing, commands, layout and reusable UI foundation | `@cms-core` |
| `src/kit/` | Code shared by plugins that cms-core does not use | Explicit `@cms-kit/<module>` entry points |
| `src/plugins/` | Document editors, viewers, panels and app routes; one folder per plugin | The plugin's own modules |

Imports flow **`plugins → kit → cms-core`**. Plugins use the public facades and never
import one another. Kit modules have separate entry points to avoid loading unrelated
dependencies; `tsconfig.paths.json` deliberately has no kit wildcard. See
[placement rules](plugins-rules.md) and [path aliases](path-aliases.md).

### cms-core subsystems

Paths below are relative to `src/cms-core/`.

| Area | Responsibility and design |
| --- | --- |
| `extensibility/` | Plugin contract, assembly and resolution |
| `dashboard-ui/` | [Application shell code map](../../src/cms-core/dashboard-ui/README.md): composition, layout, documents, toolbars, banner and preference adapters |
| `dashboard-ui/documents/`, `dashboard-ui/layout/` | [Document panel and stack](central-area.md), embedded and secondary documents, panel layout and route views |
| `files/browser/`, `files/core/` | Folder listing, browsing state and mutations (`useFileOperations.ts`) |
| `files/nav-bar/`, `files/navigation/` | [File tree](file-navigators.md), [folder indexes](folder-index.md) and navigation |
| `files/dnd/` | [File drag and drop](file-drag-drop.md) |
| `files/disk-sync/` | [Saving](saving.md) and [following disk changes](disk-sync.md) |
| `files/actions/` | [Server file actions](server-actions.md) |
| `import-gate/` | [Upload scanning and redaction](import-gate.md) |
| `files/selection/`, `files/clipboard/`, `files/context-menu/`, `files/creation/`, `files/view-mode/` | File selection, clipboard, menus, creation and display modes |
| `files/service/`, `auth/` | [Worker client and authentication](backend-access.md) |
| `hotkeys/` | [Hotkeys](commands-hotkeys.md) and command dispatch |
| `dashboard-ui/toolbars/`, `dashboard-ui/top-banner/` | [Tab placement and visibility](tool-bars.md), application controls |
| `git/` | [Git panel and application diff mode](panel-suites.md) |
| `dashboard-ui/documents/secondary/` | Second document in a central area; see below |
| `ui-foundation/layout/` | [Resizable divisions](split.md), resize handles and row-list styles |
| `ui-foundation/zoom/` | Element magnifier: Ctrl-click or 500 ms touch hold, 125% initially, 100–200% slider, Escape to close; targets use `zoomable`, including fenced Markdown blocks |
| `config/`, `toolbox/` | [Runtime configuration](runtime-config.md) and [configuration panel](configuration-panel.md) |
| `view-state/` | [Persisted UI state](view-state.md), storage model and scoped hooks |
| `dashboard-ui/preferences/` | Theme, voice-language and split-pane adapters using persisted UI state |
| `markdown/`, `text-fragment/` | Shared renderer and [passage links](passage-links.md) |
| `ui-foundation/` | [Reusable widgets and interaction helpers](../../src/cms-core/ui-foundation/README.md), grouped by purpose and independent of application services; import through `@cms-core` |
| `navigation/` | [Internal links](internal-links.md), application mount paths and internal navigation signals |
| `ui-foundation/interactions/` | Selection, pointed element state, pointer tracking and long press |
| `app-routes/` | Plugin URL-prefix declarations and matching before file paths |

## The plugin contract

| Need | Reference |
| --- | --- |
| Manifest, file resolution, capabilities and loading | [Runtime contract](plugins-runtime.md) and [TypeScript interface](../../src/cms-core/extensibility/FileBasedPlugin.ts) |
| Build selection, import map and external projects | [Assembly](plugins-assembly.md) |
| Placement constraints and reasons | [Design rules](plugins-rules.md) |
| Authoring procedure | [dashboard-plugin skill](/.agents/skills/dashboard-plugin/SKILL.md) |
| Delivered IDs and descriptions | [Catalogue](../../src/plugins/catalogue.json) |
| Plugin usage and local code maps | [Plugin guides](../../src/plugins/README.md) |

The catalogue identifies delivered plugins; each `index.tsx` defines its file claims and contributions. Inventories stay in source, not in this index. `code-edit` and `text-edit` are fallbacks. The folder browser is a core contribution in every assembly. Git stays in cms-core because it owns application diff mode.

### Secondary document (`src/cms-core/dashboard-ui/documents/secondary/`)

Call `useSecondaryDocument().open(file)` from `@cms-core` to open a second file in the
second central area; create the file first if needed. `close()` clears it. The host owns
the layout; see [central areas](tool-bars.md).

## Details

### Documents and navigation

| Design | Covers |
| --- | --- |
| [Central area](central-area.md) | Document panel, stack and addressability |
| [File tree](file-navigators.md) | Refresh, reveal and remembered branches |
| [Folder index](folder-index.md) | Opening an Index file in place of a listing |
| [File drag and drop](file-drag-drop.md) | Payloads, targets and link insertion |
| [Upload review](upload-review.md) | Staging and Delete/Import decisions |
| [Import gate](import-gate.md) | Secret scanning and redaction |
| [Internal links](internal-links.md) | Stored links, mount paths and click interception |
| [Passage links](passage-links.md) | Matching, highlighting and copying selected text |
| [Image links](image-links.md) | Resolving document-relative images |
| [Static versions](static-versions.md) | Generating `.md` from `.src.md` with embedded diagrams |

### State and application services

| Design | Covers |
| --- | --- |
| [Saving](saving.md) / [disk sync](disk-sync.md) | Autosave, external edits, conflicts and codecs |
| [View state](view-state.md) | Per-file and global UI state, config documents |
| [Provider stack](provider-stack.md) | Context order, startup and lifetimes |
| [Backend access](backend-access.md) | Worker client, tokens and authentication |
| [Runtime configuration](runtime-config.md) | `dashboard.json` flags and plugin selection |
| [Configuration panel](configuration-panel.md) | Runtimes, MCP servers and plugins |
| [Server actions](server-actions.md) | Manifest-driven file operations |
| [File optimizations](file-optimizations.md) | Duplicate consolidation and large-file reports |
| [Entry point](entry-point.md) | Bootstrap, theme and web app manifest |

### Layout and plugin internals

| Design | Covers |
| --- | --- |
| [Tool bars](tool-bars.md) | Tabs, placement, visibility and sizing |
| [Split panes](split.md) / [preview size](preview-size.md) | Weighted divisions and per-file preview zoom |
| [Panel suites](panel-suites.md) | Git and Conversations |
| [Row lists](row-lists.md) / [reordering](reordering.md) | Striping, widths and keyboard-accessible drag ordering |
| [Commands and hotkeys](commands-hotkeys.md) | Registration, context and dispatch |
| [Path aliases](path-aliases.md) | TypeScript and Vite entry points |
| [Board UI](board-ui.md) | Board routes, gestures, IDs, merging and view state |
| [ArchDia internals](plugins/archdia-edit.md) / [extension](plugins/archdia-extending.md) | Models, SVG rendering and language extractors |

## Decision records

Dashboard decisions live in [decisions](decisions/). The [shared decision index](/docs/solution-design/decisions/README.md) allocates IDs and tracks supersession, including cross-container decisions. Current behavior belongs in the owning design or local guide.
