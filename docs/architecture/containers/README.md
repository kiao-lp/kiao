# Containers

One folder per **C4 container** — an independently deployable or runnable unit: a process, an
application, a data store. A document belongs here when it concerns one container *alone*; anything
that spans two of them stays a level up, beside the [views](../views) and the
[decision logs](../decisions).

The folders are created as documents arrive, so a container with nothing written about it yet has
no folder. That is the normal state, not a gap to fill.

Naming, exclusivity and how to link into these documents are settled in
[decision 00049](/docs/architecture/decisions/00049-architecture-docs-shelves.md).

## The containers

| Container | Zone | What it is | Here |
| --- | --- | --- | --- |
| [dashboard](/exchange/dashboard/README.md) | Exchange | the React/Vite CMS single-page app, plugin-based, served as a static bundle | [dashboard](./dashboard) |
| [worker](/operation/worker/README.md) | Operation | the Go file, git and agent backend Dashboard is written against | [worker](./worker) |
| [hybridflow-store](/operation/hybridflow-store/README.md) | Operation | the boards and the cards on them, in PostgreSQL | [hybridflow-store](./hybridflow-store) |

**DCMS** and **hybridflow** are functional names that cut across these containers, not
containers themselves: DCMS is the file/content feature of Dashboard plus the `files` service
inside worker; hybridflow is the workflow/agent UI of Dashboard plus the `hybridflow-runner`
inside worker plus the hybridflow-store. Dashboard and worker each host parts of both, and
ship together — as the `kiao` image and as the `kiao` executable — but they are two containers:
two processes, two lifetimes, and nginx or the launcher between them. What is true of a
functional set is written one level up, under its functional name; what is true of one
container alone is written here.
