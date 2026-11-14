---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Dashboard solution design

Use this index to locate the code and read only the relevant design. Cross-container
contracts belong in the [central solution design index](/docs/solution-design/README.md).
Plugin usage and API references stay in [local guides](../../src/plugins/README.md).

A component's design lives in its `docs/solution-design/` under `src/core/`, `src/kit/`
or `src/plugins/`. Choose the primary owner of the behavior, including its callers,
dependencies and adapters. Shared conventions, application assembly and designs with
several owners live here; decisions stay centralized in [decisions](decisions/).

## Three source zones

| Zone | Owns | Public imports |
| --- | --- | --- |
| `src/core/` | Application framework, browsing, commands, layout and reusable UI foundation | `@kiao-dashboard-core` |
| `src/kit/` | Code shared by plugins that core does not use | Explicit `@kiao-dashboard-kit/<module>` entry points |
| `src/plugins/` | Document editors, viewers, panels and app routes; one folder per plugin | The plugin's own modules |

Imports flow **`plugins → kit → core`**. Plugins use the public facades and never
import one another. Kit modules have separate entry points to avoid loading unrelated
dependencies; `tsconfig.paths.json` deliberately has no kit wildcard. See
[placement rules](plugins-rules.md) and [path aliases](path-aliases.md).

### Component solution designs

| Folder under `src/` | Local index |
| --- | --- |
| `core/auth/` | [Backend access and authentication](../../src/core/auth/docs/solution-design/README.md) |
| `core/config/` | [Runtime configuration](../../src/core/config/docs/solution-design/README.md) |
| `core/dashboard-ui/` | [Application shell, documents and toolbars](../../src/core/dashboard-ui/docs/solution-design/README.md) |
| `core/extensibility/` | [Plugin runtime contract and loading](../../src/core/extensibility/docs/solution-design/README.md) |
| `core/files/` | [File browsing, synchronization, actions and uploads](../../src/core/files/docs/solution-design/README.md) |
| `core/git/` | [Git panel and application diff mode](../../src/core/git/docs/solution-design/README.md) |
| `core/hotkeys/` | [Commands and hotkeys](../../src/core/hotkeys/docs/solution-design/README.md) |
| `core/import-gate/` | [Scanning, rendering and redaction](../../src/core/import-gate/docs/solution-design/README.md) |
| `core/markdown/` | [Markdown image resolution](../../src/core/markdown/docs/solution-design/README.md) |
| `core/navigation/` | [Internal links and navigation](../../src/core/navigation/docs/solution-design/README.md) |
| `core/text-fragment/` | [Passage links](../../src/core/text-fragment/docs/solution-design/README.md) |
| `core/toolbox/` | [Configuration panel](../../src/core/toolbox/docs/solution-design/README.md) |
| `core/ui-foundation/` | [Reusable layout and interaction components](../../src/core/ui-foundation/docs/solution-design/README.md) |
| `core/view-state/` | [Persisted UI state](../../src/core/view-state/docs/solution-design/README.md) |
| `kit/archdia/` | [Diagram engine, file integration and language extensions](../../src/kit/archdia/docs/solution-design/README.md) |
| `kit/MarkdownEditor/` | [Markdown preview sizing](../../src/kit/MarkdownEditor/docs/solution-design/README.md) |
| `plugins/chat/` | [Conversations panel](../../src/plugins/chat/docs/solution-design/README.md) |
| `plugins/file-optimizations/` | [Duplicate consolidation and large-file reports](../../src/plugins/file-optimizations/docs/solution-design/README.md) |
| `plugins/hybridflow-ui/` | [Board UI](../../src/plugins/hybridflow-ui/docs/solution-design/README.md) |
| `plugins/markdown-edit/` | [Static Markdown versions](../../src/plugins/markdown-edit/docs/solution-design/README.md) |

### core subsystems

Paths below are relative to `src/core/`.

| Area | Responsibility and design |
| --- | --- |
| `extensibility/` | Plugin contract, assembly and resolution |
| `dashboard-ui/` | [Application shell code map](../../src/core/dashboard-ui/README.md): composition, layout, documents, toolbars, banner and preference adapters |
| `dashboard-ui/documents/`, `dashboard-ui/layout/` | [Document panel and stack](../../src/core/dashboard-ui/docs/solution-design/central-area.md), embedded and secondary documents, panel layout and route views |
| `files/browser/`, `files/core/` | Folder listing, browsing state and mutations (`useFileOperations.ts`) |
| `files/nav-bar/`, `files/navigation/` | [File tree](../../src/core/files/docs/solution-design/file-navigators.md), [folder indexes](../../src/core/files/docs/solution-design/folder-index.md) and navigation |
| `files/dnd/` | [File drag and drop](../../src/core/files/docs/solution-design/file-drag-drop.md) |
| `files/disk-sync/` | [Saving](saving.md) and [following disk changes](../../src/core/files/docs/solution-design/disk-sync.md) |
| `files/actions/` | [Server file actions](../../src/core/files/docs/solution-design/server-actions.md) |
| `import-gate/` | [Upload scanning and redaction](../../src/core/import-gate/docs/solution-design/import-gate.md) |
| `files/selection/`, `files/clipboard/`, `files/context-menu/`, `files/creation/`, `files/view-mode/` | File selection, clipboard, menus, creation and display modes |
| `files/service/`, `auth/` | [Worker client and authentication](../../src/core/auth/docs/solution-design/backend-access.md) |
| `hotkeys/` | [Hotkeys](../../src/core/hotkeys/docs/solution-design/commands-hotkeys.md) and command dispatch |
| `dashboard-ui/toolbars/`, `dashboard-ui/top-banner/` | [Tab placement and visibility](../../src/core/dashboard-ui/docs/solution-design/tool-bars.md), application controls |
| `git/` | [Git panel and application diff mode](../../src/core/git/docs/solution-design/git-panel.md) |
| `dashboard-ui/documents/secondary/` | Second document in a central area; see below |
| `ui-foundation/layout/` | [Resizable divisions](../../src/core/ui-foundation/docs/solution-design/split.md), resize handles and row-list styles |
| `ui-foundation/zoom/` | Element magnifier: Ctrl-click or 500 ms touch hold, 125% initially, 100–200% slider, Escape to close; targets use `zoomable`, including fenced Markdown blocks |
| `config/`, `toolbox/` | [Runtime configuration](../../src/core/config/docs/solution-design/runtime-config.md) and [configuration panel](../../src/core/toolbox/docs/solution-design/configuration-panel.md) |
| `view-state/` | [Persisted UI state](../../src/core/view-state/docs/solution-design/view-state.md), storage model and scoped hooks |
| `dashboard-ui/preferences/` | Theme, voice-language and split-pane adapters using persisted UI state |
| `markdown/`, `text-fragment/` | Shared renderer and [passage links](../../src/core/text-fragment/docs/solution-design/passage-links.md) |
| `ui-foundation/` | [Reusable widgets and interaction helpers](../../src/core/ui-foundation/README.md), grouped by purpose and independent of application services; import through `@kiao-dashboard-core` |
| `navigation/` | [Internal links](../../src/core/navigation/docs/solution-design/internal-links.md), application mount paths and internal navigation signals |
| `ui-foundation/interactions/` | Selection, pointed element state, pointer tracking and long press |
| `app-routes/` | Plugin URL-prefix declarations and matching before file paths |

## The plugin contract

| Need | Reference |
| --- | --- |
| Manifest, file resolution, capabilities and loading | [Runtime contract](../../src/core/extensibility/docs/solution-design/plugins-runtime.md) and [TypeScript interface](../../src/core/extensibility/FileBasedPlugin.ts) |
| Build selection, import map and external projects | [Assembly](plugins-assembly.md) |
| Placement constraints and reasons | [Design rules](plugins-rules.md) |
| Authoring procedure | [dashboard-plugin skill](/.agents/skills/dashboard-plugin/SKILL.md) |
| Delivered IDs and descriptions | [Catalogue](../../src/plugins/catalogue.json) |
| Plugin usage and local code maps | [Plugin guides](../../src/plugins/README.md) |

The catalogue identifies delivered plugins; each `index.tsx` defines its file claims and contributions. Inventories stay in source, not in this index. `code-edit` and `text-edit` are fallbacks. The folder browser is a core contribution in every assembly. Git stays in core because it owns application diff mode.

### Secondary document (`src/core/dashboard-ui/documents/secondary/`)

Call `useSecondaryDocument().open(file)` from `@kiao-dashboard-core` to open a second file in the
second central area; create the file first if needed. `close()` clears it. The host owns
the layout; see [central areas](../../src/core/dashboard-ui/docs/solution-design/tool-bars.md).

## Details

### Documents and navigation

| Design | Covers |
| --- | --- |
| [Central area](../../src/core/dashboard-ui/docs/solution-design/central-area.md) | Document panel, stack and addressability |
| [File tree](../../src/core/files/docs/solution-design/file-navigators.md) | Refresh, reveal and remembered branches |
| [Folder index](../../src/core/files/docs/solution-design/folder-index.md) | Opening an Index file in place of a listing |
| [File drag and drop](../../src/core/files/docs/solution-design/file-drag-drop.md) | Payloads, targets and link insertion |
| [Upload review](../../src/core/files/docs/solution-design/upload-review.md) | Staging and Delete/Import decisions |
| [Import gate](../../src/core/import-gate/docs/solution-design/import-gate.md) | Secret scanning and redaction |
| [Internal links](../../src/core/navigation/docs/solution-design/internal-links.md) | Stored links, mount paths and click interception |
| [Passage links](../../src/core/text-fragment/docs/solution-design/passage-links.md) | Matching, highlighting and copying selected text |
| [Image links](../../src/core/markdown/docs/solution-design/image-links.md) | Resolving document-relative images |
| [Static versions](../../src/plugins/markdown-edit/docs/solution-design/static-versions.md) | Generating `.md` from `.src.md` with embedded diagrams |

### State and application services

| Design | Covers |
| --- | --- |
| [Saving](saving.md) / [disk sync](../../src/core/files/docs/solution-design/disk-sync.md) | Autosave, external edits, conflicts and codecs |
| [View state](../../src/core/view-state/docs/solution-design/view-state.md) | Per-file and global UI state, config documents |
| [Provider stack](../../src/core/dashboard-ui/docs/solution-design/provider-stack.md) | Context order, startup and lifetimes |
| [Backend access](../../src/core/auth/docs/solution-design/backend-access.md) | Worker client, tokens and authentication |
| [Runtime configuration](../../src/core/config/docs/solution-design/runtime-config.md) | `dashboard.json` flags and plugin selection |
| [Configuration panel](../../src/core/toolbox/docs/solution-design/configuration-panel.md) | Runtimes, MCP servers and plugins |
| [Server actions](../../src/core/files/docs/solution-design/server-actions.md) | Manifest-driven file operations |
| [File optimizations](../../src/plugins/file-optimizations/docs/solution-design/file-optimizations.md) | Duplicate consolidation and large-file reports |
| [Entry point](entry-point.md) | Bootstrap, theme and web app manifest |

### Layout and plugin internals

| Design | Covers |
| --- | --- |
| [Tool bars](../../src/core/dashboard-ui/docs/solution-design/tool-bars.md) | Tabs, placement, visibility and sizing |
| [Split panes](../../src/core/ui-foundation/docs/solution-design/split.md) / [preview size](../../src/kit/MarkdownEditor/docs/solution-design/preview-size.md) | Weighted divisions and per-file preview zoom |
| [Git panel](../../src/core/git/docs/solution-design/git-panel.md) / [Conversations](../../src/plugins/chat/docs/solution-design/conversations.md) | Git integration and conversation lifecycle |
| [Row lists](../../src/core/ui-foundation/docs/solution-design/row-lists.md) / [reordering](../../src/core/ui-foundation/docs/solution-design/reordering.md) | Striping, widths and keyboard-accessible drag ordering |
| [Commands and hotkeys](../../src/core/hotkeys/docs/solution-design/commands-hotkeys.md) | Registration, context and dispatch |
| [Path aliases](path-aliases.md) | TypeScript and Vite entry points |
| [Board UI](../../src/plugins/hybridflow-ui/docs/solution-design/board-ui.md) | Board routes, gestures, IDs, merging and view state |
| [ArchDia internals](../../src/kit/archdia/docs/solution-design/archdia-edit.md) / [extension](../../src/kit/archdia/docs/solution-design/archdia-extending.md) | Models, SVG rendering and language extractors |

## Decision records

All Dashboard decisions stay centralized in [decisions](decisions/). The
[shared decision index](/docs/solution-design/decisions/README.md) allocates IDs and tracks
supersession, including cross-container decisions. Current behavior belongs in the owning
design or local guide.
The format and authoring reference is [kiao-adr](/reference/kiao-skills/kiao-adr/SKILL.md).
