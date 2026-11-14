---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# The configuration panel (`src/core/toolbox/`)

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

The **Configuration…** tools-menu entry opens a panel over the focussed central tab. One searchable list combines runtimes, MCP servers and Dashboard plugins. Kind icons
match the filter chips; search matches title, description and ID.

## Ownership and behavior

| Kind | Owner | Controls |
| --- | --- | --- |
| Runtime or MCP server | Worker machine; catalogue compiled into worker | Installation jobs and, for MCP, registration |
| Dashboard plugin | Build catalogue and store `dashboard.json` | Store selection, applied to the browser after reload |

Requests send only catalogue IDs, never arbitrary shell commands, package names or versions.
The worker owns install commands and validation; see its [toolbox contract](/operation/worker/PROTOCOL/toolbox.md)
and [toolbox design](/operation/worker/docs/solution-design/toolbox.md).

Installation jobs survive panel closure. The UI polls their state and logs. Dependency prompts
use the catalogue already loaded (`missingRequires`); software not installed by this service
has no uninstall control.

Plugin changes save the requested list and explain the required reload: manifests establish
the provider stack once before initial rendering. The panel names requested plugins absent
from the build. See [assembly selection](../../../../../docs/solution-design/plugins-assembly.md) and
[runtime enablement](../../../extensibility/docs/solution-design/plugins-runtime.md#the-two-enablement-levels).

MCP rows show tool count and definition bytes per model request. Installation and registration are separate controls. Registered servers here are the exact set each turn receives.

## Code map

| File | Responsibility |
| --- | --- |
| `useToolbox.ts` | Catalogue, installation jobs and polling |
| `ToolboxPanel.tsx` | Unified rows, dependency prompts and controls |
| `usePlugins.ts` | Built catalogue, store choices, missing IDs and reload state |
| `itemKinds.tsx`, `ToolboxFilter.tsx` | Shared kind icons, filters and search |
| `menuItems.tsx` | Tools menu items for Configuration and Pi profiles |
