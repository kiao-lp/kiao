---
status: DRAFT
role: PRIMARY_SOURCE
---

# DCMS — solution designs

Document management. The [document](../../../architecture/data/dcms-concept-catalog.md)
is the information artifact managed by DCMS, including those used to produce content for
publication or distribution. This partition owns designs for the DCMS functional
set: Dashboard's file-oriented views plus worker's `files` service (see
[functional sets](../../decisions/00064-functional-sets.md) and the
[container catalogue](../../containers.md)). Container-specific detail stays in each
container's local `docs/solution-design`; this partition holds only designs spanning
the set.

| Design | Scope |
| --- | --- |
| [File actions](./file-actions.md) | The Dashboard-to-worker-to-provider contracts and execution sequence. |
