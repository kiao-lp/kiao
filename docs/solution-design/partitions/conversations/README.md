---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Conversations — solution designs

Free and board conversations, turns and harness execution. This partition owns designs
for conversation behaviour spanning Dashboard, worker's conversation engine and,
where board-linked, hybridflow. Container-specific detail stays in each container's
local `docs/solution-design` (for example worker's
[conversations](/operation/worker/docs/solution-design/conversations.md)); this
partition holds only designs spanning those parts.

## Proposals

| Design | Scope |
| --- | --- |
| [Pi integration](./pi-harness-plan.md) | Proposed shared execution lifecycle and reusable execution profiles, with its relationship to the accepted implementation decision. |
