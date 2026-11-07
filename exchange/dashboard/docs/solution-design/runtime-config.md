---
status: DRAFT
role: PRIMARY_SOURCE
---

# Runtime configuration (`src/cms-core/config/`)

Part of the [Dashboard solution design](README.md).

[DashboardConfigProvider](../../src/cms-core/config/DashboardConfig-ctx.tsx) loads
`dashboard.json` through `WorkerClient.getConfigJson` before rendering children.

| Input | Result |
| --- | --- |
| Existing document | Normalize fields and alias names |
| Missing document (404) | Seed and use defaults |
| Other read/parse error | Open with defaults |
| `chatEnabled` or `gitEnabled` | Enabled unless explicitly `false` |
| Absent `plugins` list | Load every plugin in the build |
| Empty `plugins` list | Load none |

The configuration controls [plugin assembly](plugins-assembly.md). Flags gate routes and tabs;
they do not unload manifests or providers. See
[enablement levels](plugins-runtime.md#the-two-enablement-levels) and
[config document storage](view-state.md#config-documents).
