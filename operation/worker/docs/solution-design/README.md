---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# worker solution design

worker owns the document store, harness execution and machine tooling behind Dashboard.
Start with the [service README](../../README.md) for its purpose and access contract.
The [central solution design index](/docs/solution-design/README.md) links to
cross-container designs and the shared decision index.

| Design | Read when |
| --- | --- |
| [Components](./components.md) | Reviewing package boundaries, execution ports, callbacks or state ownership. |
| [Request lifecycle](./request-handling.md) | Changing middleware, logging or shutdown. |
| [Operational state](./state.md) | Changing state isolation, persistence, process locking or legacy adoption. |
| [Store scope](/migrations/README.md#kiao-files) | Changing `.kiao-files`, automatic-pass exclusions or declaration seeding. |
| [Config documents](../../PROTOCOL/config-documents.md) | Changing allowed state documents, validation or save listeners. |
| [Endpoints](./endpoints.md) | Adding or calling an HTTP endpoint. |
| [Conversations and turns](./conversations.md) | Working on harnesses, permissions, forks or turn execution. |
| [Claude control input](decisions/00063-claude-input-ends-at-idle.md) | Investigating intermediate results, closed approval channels or result bursts. |
| [Conversation files](./conversation-folder.md) | Reviewing persisted metadata, transcripts and turn traces. |
| [Playing a board](./playing-board.md) | Changing chain runs, retries, usage limits or board marking. |
| [Quiet Muse turns](./muse-quiet-turn.md) | Reviewing silence detection, recovery and the fork limit. |
| [File actions](/docs/solution-design/partitions/dcms/file-actions.md) | Changing manifest routing or provider integration across DCMS. |
| [The toolbox](./toolbox.md) | Installing runtimes and MCP servers or selecting turn equipment. |
| [Configuration](./configuration.md) | Changing environment variables or migration source configuration. |
| [Build, run and code map](./build-code-map.md) | Building, testing or locating a source file's responsibility. |

The [shared decision index](/docs/solution-design/decisions/README.md) references
worker-only records in [decisions](./decisions) and global records for shared contracts.
