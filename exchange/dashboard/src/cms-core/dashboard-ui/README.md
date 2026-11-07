---
status: DRAFT
role: PRIMARY_SOURCE
---

# Dashboard UI

The Dashboard application shell lives here. It composes feature contributions, renders
the application frame and document areas, and connects reusable widgets to saved preferences.

| Folder | Owns |
| --- | --- |
| `app/` | Application providers, core and plugin contributions, theme configuration and viewport styles |
| `layout/` | Panel-area layout and the view that opens plugin app routes |
| `documents/` | Active document view, document tab, dialog containment, central panel stack and embedded documents |
| `documents/secondary/` | Second document state, tab and view |
| `top-banner/` | Application banner, visibility and Tools menus, companion and language switches |
| `toolbars/` | Tab registration, placement, visibility, sizing and rendering |
| `preferences/` | Persisted theme, voice-language and split-pane adapters |

Reusable components stay in [ui-foundation](../ui-foundation/README.md). Their Dashboard
adapters live here; the storage model and scoped persistence hooks stay in `view-state/`.
Plugin contracts, assembly and resolution stay in `extensibility/`; route declarations and
matching stay in `app-routes/`.

File browsing, Git, Markdown, upload review and Configuration keep their feature modules.
The shell registers their contributions without owning their implementation. Authentication
and startup remain in `src/App.tsx`; worker-client creation stays in `files/service/`.

Plugins use the existing [public facade](../public-api.ts), which exports the shell's layout,
document, toolbar and preference APIs alongside the reusable widgets.
