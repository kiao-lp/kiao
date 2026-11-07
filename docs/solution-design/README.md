---
status: DRAFT
role: PRIMARY_SOURCE
---

# Solution designs

This is the central index for solution-specific documentation, implementation reviews and
implementation guidance. The [architecture preliminaries](../architecture/README.md) define the distinction
and placement rules. Global designs live here; designs concerning one container live in that
container's `docs/solution-design` directory.

## Global designs

| Design | Scope |
| --- | --- |
| [Services and functions](./views/Functions.md) | External services and internal functions mapped to deployable containers. |
| [Container flows](./views/Flows.md) | Connections between the interface, gateway, services and persistence. |
| [Deployment](./views/Deployment.md) | Processes, routing and packaging in the image and installed executable. |
| [Container catalogue](./containers.md) | Container responsibilities and links to their local solution designs. |
| [Named file-store migrations](../../migrations/README.md) | Source identities, independent ledgers, authoring and delivery across assemblies. |
| [Published agent versions](./decisions/00075-agent-publications.md) | Drafts, immutable publications, archives and the configuration captured by conversations. |

## Partitions

Designs grouped by functional area. Each partition index owns its pages; read it for
scope and container links.

| Partition | Scope |
| --- | --- |
| [Hybridflow](./partitions/hybridflow/README.md) | Boards, flow nodes, task chains and playback. |
| [DCMS](./partitions/dcms/README.md) | Document management. |
| [Conversations](./partitions/conversations/README.md) | Free and board conversations, turns and agent execution. |
| [Environment and equipment](./partitions/environment-equipment/README.md) | Delivered resources, runtimes and the toolbox. |

## Container-specific designs

Each linked index owns the detailed pages for its container, including implementation decisions.

| Container | Local solution designs |
| --- | --- |
| Dashboard | [Source map, plugins, file editing, panels and board UI](../../exchange/dashboard/docs/solution-design/README.md) |
| worker | [Components, requests, conversations, playback, configuration and code map](../../operation/worker/docs/solution-design/README.md) |
| hybridflow-store | [Service structure, schema, migrations and deployment configuration](../../operation/hybridflow-store/docs/solution-design/README.md) |

## Decision records

Read the [decision index](./decisions/README.md) for chronological IDs and task triggers.
It links to global records here and to single-container records in their local solution designs;
IDs and supersession relationships are shared across those locations.
