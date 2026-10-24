# worker solution design

worker owns the document store, agent execution and machine tooling behind Dashboard.
Start with the [service README](../../README.md) for its purpose and access contract.
The [central solution design index](/docs/solution-design/README.md) links to
cross-container designs and the shared decision index.

| Design | Read when |
| --- | --- |
| [Components](./components.md) | Reviewing package boundaries, execution ports, callbacks or state ownership. |
| [Request handling and state](./request-handling.md) | Changing middleware, logging, shutdown or the state directory. |
| [Endpoints](./endpoints.md) | Adding or calling an HTTP endpoint. |
| [Conversations and turns](./conversations.md) | Working on agents, permissions, forks or turn execution. |
| [Conversation files](./conversation-folder.md) | Reviewing persisted metadata, transcripts and turn traces. |
| [Playing a board](./playing-board.md) | Changing chain runs, retries, usage limits or board marking. |
| [Quiet Muse turns](./muse-quiet-turn.md) | Reviewing silence detection, recovery and the fork limit. |
| [File actions and the toolbox](./actions-toolbox.md) | Routing file actions or installing runtimes and MCP servers. |
| [Configuration](./configuration.md) | Changing environment variables or migration source configuration. |
| [Build, run and code map](./build-code-map.md) | Building, testing or locating a source file's responsibility. |
| [Deviations from the Java version](./deviations.md) | Investigating deliberate compatibility differences. |

The [shared decision index](/docs/solution-design/decisions/README.md) references
worker-only records in [decisions](./decisions) and global records for shared contracts.
