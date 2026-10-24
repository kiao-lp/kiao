# Container catalogue

A **C4 container** is an independently deployable or runnable unit. The implemented solution
uses the following containers; each owns its solution design under `docs/solution-design`
beside its code.

| Container | Zone | Responsibility | Solution design |
| --- | --- | --- | --- |
| [Dashboard](/exchange/dashboard/README.md) | Exchange | The React/Vite interface and plugin host. | [Dashboard](/exchange/dashboard/docs/solution-design/README.md) |
| [worker](/operation/worker/README.md) | Operation | The Go file, git and agent backend. | [worker](/operation/worker/docs/solution-design/README.md) |
| [hybridflow-store](/operation/hybridflow-store/README.md) | Operation | Boards, flow nodes, agents and runners persisted in PostgreSQL. | [hybridflow-store](/operation/hybridflow-store/docs/solution-design/README.md) |

**DCMS** and **hybridflow** are functional sets spanning these containers. DCMS combines
Dashboard's file-oriented views with worker's `files` service. Hybridflow combines Dashboard's
workflow and conversation UI, worker's `hybridflow-runner` and hybridflow-store. Dashboard and
worker each host parts of both sets.

The containers ship together as **kiao**, in an image or an installed executable, while retaining
separate processes and lifetimes. See the [deployment design](./views/Deployment.md).

Designs spanning several containers belong in the [global solution design area](./README.md),
with links to the relevant local details. Create a local design directory when there is material
to put in it. The [documentation decision](./decisions/00077-architecture-and-solution-design.md)
supersedes the historical centralized container shelves.
