---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Runtime configuration (`src/core/config/`)

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

[DashboardConfigProvider](../../DashboardConfig-ctx.tsx) loads
`dashboard.json` through `WorkerClient.getConfigJson` before rendering children.

| Input | Result |
| --- | --- |
| Existing document | Normalize fields and alias names |
| Missing document (404) | Seed and use defaults |
| Other read/parse error | Open with defaults |
| `chatEnabled` or `gitEnabled` | Enabled unless explicitly `false` |
| Absent `plugins` list | Load the default plugins available in the build |
| Empty `plugins` list | Load none |

The default selection enables every available plugin except Video (`movie-edit`),
TTS scripts (`ttst-edit`), File optimizations (`file-optimizations`), 3D models
(`three-d-model-view`), Activity log (`activity-log`), Graphs (`graph-edit`) and ePub
(`epub-view`). These plugins remain available in Configuration.

The configuration controls [plugin assembly](../../../../../docs/solution-design/plugins-assembly.md). Flags gate routes and tabs;
they do not unload manifests or providers. See
[enablement levels](../../../extensibility/docs/solution-design/plugins-runtime.md#the-two-enablement-levels) and
[config document storage](../../../view-state/docs/solution-design/view-state.md#config-documents).
