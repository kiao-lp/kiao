---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# KIAO

Kiao is the deliverable that combines DCMS and hybridflow in a Docker image and a `kiao` executable.

- **DCMS**: document and content management. Dashboard provides the file views, [worker](/operation/worker/README.md) provides storage, Git and search.
- **hybridflow**: agentic workflow management. Dashboard provides the boards and conversations, [worker](/operation/worker/README.md) runs the turns, [hybridflow-store](/operation/hybridflow-store/README.md) stores boards, flow nodes and runners in PostgreSQL. [agentic-resource-manager](/operation/agentic-resource-manager/README.md) manages agent Git/APM repositories.

Base components: [agentic-resource-manager](/operation/agentic-resource-manager/README.md), [Dashboard](/exchange/dashboard/README.md), [worker](/operation/worker/README.md), [hybridflow-store](/operation/hybridflow-store/README.md).

## Build from source

With Go 1.27.3+ and Node.js 20+ with npm, run `./bin/build-all.sh` in the published checkout.
Then [build the Docker image](docs/user-manual/deep-dive/kiao-docker.md#build-or-load-the-image)
or [install the executable](docs/user-manual/deep-dive/kiao-executable.md#install).
The checkout includes the pinned MCP sources used by both builds.

## Contents

[Documentation by use case](/docs/README.md): use kiao, develop, understand the architecture, design a solution.

## Collaborations

I'm interested in collaborations. Contact me via [KIAO on LinkedIn](https://www.linkedin.com/company/kiao-suite) or follow the page.
