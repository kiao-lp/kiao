---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Hybridflow — solution designs

Boards, flow nodes, task chains and playback. This partition owns designs for the
hybridflow functional set: Dashboard's board and conversation UI, worker's
`hybridflow-runner`, and hybridflow-store (see
[functional sets](../../decisions/00048-functional-sets.md) and the
[container catalogue](../../containers.md)). Container-specific detail stays in each
container's local `docs/solution-design`; this partition holds only designs spanning
the set.

| Design | Scope |
| --- | --- |
| [Board and task interactions](./interactions.md) | How Dashboard, worker and hybridflow-store coordinate board updates and playback. |
| [Structured task data](./structured-task-data.md) | JSON Schema outputs and predecessor inputs across task chains. |
