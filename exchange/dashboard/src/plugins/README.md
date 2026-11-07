---
status: DRAFT
role: PRIMARY_SOURCE
---

# Dashboard plugins

Delivered plugins live in `src/plugins/<id>/index.tsx` and are listed in
[catalogue.json](catalogue.json). External projects join the same catalogue through
`VITE_PLUGIN_PATHS`. The build selects what ships; the store selects what loads.
Plugins may handle file types or provide panels, application pages and other contributions.
Only the plugin's `id` is required; `fileConfigFor` is optional.

| Task | Reference |
| --- | --- |
| Write or extend a plugin | [dashboard-plugin skill](/.agents/skills/dashboard-plugin/SKILL.md) |
| Understand the manifest, resolution or capabilities | [Runtime contract](../../docs/solution-design/plugins-runtime.md) |
| Change builds or add an external project | [Assembly](../../docs/solution-design/plugins-assembly.md) |
| Decide where behavior belongs | [Design rules](../../docs/solution-design/plugins-rules.md) |

## Local guides

Each guide owns its plugin's usage and implementation details. For other plugins, start
with their manifest; `fileConfigFor` and `fileExtensions` define file claims.

| Plugin | Guide |
| --- | --- |
| Activity log | [Time entries and configuration](activity-log/README.md) |
| ArchDia | [Diagram editor](archdia-edit/README.md) |
| Bookmarks | [Bookmark panel and storage](bookmarks/README.md) |
| File optimizations | [Duplicate and large-file reports](file-optimizations/README.md) |
| Hybridflow | [Boards, cards and runs](hybridflow-ui/README.md) |
| Images | [Viewing and navigation](image-view/README.md) |
| JSON Schema | [Schema editor](json-schema-edit/README.md) |
| Markdown | [Metadata and exports](markdown-edit/README.md) |
| Movies and audio | [Playback, segments and sidecars](movie-edit/README.md) |
| SVG | [Canvas and source editing](svg-edit/README.md) |
| Tags | [Tag words, colors and picker](tags/README.md) |
| 3D models | [GLB viewer and inspector](three-d-model-view/README.md) |
| TTS scripts | [Scripts, voices and generation](ttst-edit/README.md) |
