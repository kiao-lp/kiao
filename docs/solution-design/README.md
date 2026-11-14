---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Solution designs

This is the central index for solution-specific documentation, implementation reviews and
implementation guidance. The [architecture preliminaries](../architecture/README.md) define the distinction
and placement rules. Global designs live here; designs concerning one container live in that
container's `docs/solution-design` directory. Within Dashboard, a component's design lives
in its `docs/solution-design` under `src/core/`, `src/kit/` or `src/plugins/`, including
its integration with callers and dependencies.

## Global designs

| Design | Scope |
| --- | --- |
| [Services and functions](./views/Functions.md) | External services and internal functions mapped to deployable containers. |
| [Container flows](./views/Flows.md) | Connections between the interface, gateway, services and persistence. |
| [Deployment](./views/Deployment.md) | Processes, routing and packaging in the image and installed executable. |
| [Container catalogue](./containers.md) | Container responsibilities and links to their local solution designs. |
| [Named file-store migrations](../../migrations/README.md) | Source identities, independent ledgers, authoring and delivery across assemblies. |
| [Published agent versions](decisions/00058-agent-publications.md) | Drafts, immutable publications, archives and the configuration captured by conversations. |

## Partitions

Designs grouped by functional area. Each partition index owns its pages; read it for
scope and container links.

| Partition | Scope |
| --- | --- |
| [Hybridflow](./partitions/hybridflow/README.md) | Boards, flow nodes, task chains and playback. |
| [DCMS](./partitions/dcms/README.md) | Document management. |
| [Conversations](./partitions/conversations/README.md) | Free and board conversations, turns and harness execution. |
| [Environment and equipment](./partitions/environment-equipment/README.md) | Delivered resources, runtimes and the toolbox. |

## Container-specific designs

Each linked index owns the detailed pages for its container, including implementation decisions.

| Container | Local solution designs |
| --- | --- |
| Dashboard | [Source map, plugins, file editing, panels and board UI](../../exchange/dashboard/docs/solution-design/README.md) |
| worker | [Components, requests, state, store scope, conversations, playback, toolbox, configuration and code map](../../operation/worker/docs/solution-design/README.md) |
| hybridflow-store | [Service structure, schema, migrations and deployment configuration](../../operation/hybridflow-store/docs/solution-design/README.md) |

### Dashboard component designs

| Component under `exchange/dashboard/src/` | Local solution designs |
| --- | --- |
| `core/auth/` | [Backend access and authentication](../../exchange/dashboard/src/core/auth/docs/solution-design/README.md) |
| `core/config/` | [Runtime configuration](../../exchange/dashboard/src/core/config/docs/solution-design/README.md) |
| `core/dashboard-ui/` | [Application shell, documents and toolbars](../../exchange/dashboard/src/core/dashboard-ui/docs/solution-design/README.md) |
| `core/extensibility/` | [Plugin runtime contract and loading](../../exchange/dashboard/src/core/extensibility/docs/solution-design/README.md) |
| `core/files/` | [File browsing, synchronization, actions and uploads](../../exchange/dashboard/src/core/files/docs/solution-design/README.md) |
| `core/git/` | [Git panel and application diff mode](../../exchange/dashboard/src/core/git/docs/solution-design/README.md) |
| `core/hotkeys/` | [Commands and hotkeys](../../exchange/dashboard/src/core/hotkeys/docs/solution-design/README.md) |
| `core/import-gate/` | [Scanning, rendering and redaction](../../exchange/dashboard/src/core/import-gate/docs/solution-design/README.md) |
| `core/markdown/` | [Markdown image resolution](../../exchange/dashboard/src/core/markdown/docs/solution-design/README.md) |
| `core/navigation/` | [Internal links and navigation](../../exchange/dashboard/src/core/navigation/docs/solution-design/README.md) |
| `core/text-fragment/` | [Passage links](../../exchange/dashboard/src/core/text-fragment/docs/solution-design/README.md) |
| `core/toolbox/` | [Configuration panel](../../exchange/dashboard/src/core/toolbox/docs/solution-design/README.md) |
| `core/ui-foundation/` | [Reusable layout and interaction components](../../exchange/dashboard/src/core/ui-foundation/docs/solution-design/README.md) |
| `core/view-state/` | [Persisted UI state](../../exchange/dashboard/src/core/view-state/docs/solution-design/README.md) |
| `kit/archdia/` | [Diagram engine, file integration and language extensions](../../exchange/dashboard/src/kit/archdia/docs/solution-design/README.md) |
| `kit/MarkdownEditor/` | [Markdown preview sizing](../../exchange/dashboard/src/kit/MarkdownEditor/docs/solution-design/README.md) |
| `plugins/chat/` | [Conversations panel](../../exchange/dashboard/src/plugins/chat/docs/solution-design/README.md) |
| `plugins/file-optimizations/` | [Duplicate consolidation and large-file reports](../../exchange/dashboard/src/plugins/file-optimizations/docs/solution-design/README.md) |
| `plugins/hybridflow-ui/` | [Board UI](../../exchange/dashboard/src/plugins/hybridflow-ui/docs/solution-design/README.md) |
| `plugins/markdown-edit/` | [Static Markdown versions](../../exchange/dashboard/src/plugins/markdown-edit/docs/solution-design/README.md) |

## Decision records

Read the [decision index](./decisions/README.md) for chronological IDs and task triggers.
It links to global records here and to single-container records in their local solution designs;
IDs and supersession relationships are shared across those locations.
Use [kiao-adr](/reference/kiao-skills/kiao-adr/SKILL.md) for the format and authoring conventions.
