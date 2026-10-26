# Pi integration — proposed solution design

Proposal dated 18 October 2026. The accepted execution-profile contract is recorded in
[decision 00072](./decisions/00072-pi-execution-profiles.md); this page describes the wider
integration proposal rather than claiming every capability is implemented.

Integrate **Pi (Agent)** into conversations and hybridflow through worker's common engine port,
using an RPC adapter.

| Element | Responsibility |
| --- | --- |
| Pi installation | Provide an engine version; several versions may coexist. |
| Execution profile | Select the installation and carry API connections, secret references, available models and extensions. |
| hybridflow agent | Reference a profile, select a model and provide standing instructions. |
| Free conversation | Select a profile and model directly, without a board agent. |

**Profiles are independent of agents and reusable across them.** A profile can offer GPT and
DeepSeek through their respective connections. Multiple profiles distinguish accounts, APIs,
models and Pi versions. Connections belong to the profile.

worker resolves the profile on the runner executing the work and composes the turn configuration.
The boards store keeps the profile reference; secrets remain with worker. An unavailable profile
produces an explicit refusal.

Conversations and chains share one execution lifecycle and monitoring mechanisms. Native Pi
sessions provide resumption, branching and compaction; changing profiles creates a separate
session with the context passed to it. Available capabilities depend on the engine and model:
reasoning, steering, queued messages, tools and user interactions. MCP, skills and extensions
integrate with the resources KIAO already provides.

Implementation reviews must distinguish the accepted profile contract from proposed session
and capability behavior, and define work packages and validation criteria for each increment.
