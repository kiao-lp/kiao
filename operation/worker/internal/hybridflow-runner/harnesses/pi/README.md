---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Pi adapter qualification

The adapter supports [Pi **1.5.2**](https://github.com/earendil-works/pi/releases/tag/v1.5.2) through `pi-rpc-1.5`.
The installable distribution is the official npm install package and lock from that release,
verified against its `SHA256SUMS`; npm verifies package integrity with scripts disabled.
Node.js 22.19+, 23.8+ or 24+ with Zstandard support is required.
Linux release archives are not used as evidence of musl support.

Pi 1.5.2 passed qualification on native Linux and the kiao Alpine image.
It uses a simulated OpenAI-compatible endpoint and an authenticated stdio MCP server, with the
**production KIAO bridge**. There are no paid model calls or external credentials.

From the distribution root:

```bash
KIAO_PI_QUALIFY_CLI=/absolute/path/to/pi \
  KIAO_PI_QUALIFY_OUTPUT=/tmp/pi-qualification \
  python3 operation/worker/internal/hybridflow-runner/harnesses/pi/qualify.py
```

The script covers startup, LF/Unicode framing, catalogue and thinking levels, native images, responses, native
resume/clone/fork, source preservation, compaction, authenticated MCP, parallel Codemode calls,
native and nested approvals/refusals, user questions, steering, follow-ups, queue clearing and
abort during a parked permission. `testdata/rpc-*.jsonl` contains the qualified exchanges with
volatile filesystem roots normalized. `fake-pi.mjs` drives deterministic driver and browser tests.

Real-runtime Go integration also uses simulated HTTP APIs, including two simultaneous accounts
exposing the same provider/model through different endpoints, and verifies secret redaction:

```bash
cd operation/worker
KIAO_PI_TEST_CLI=/absolute/path/to/pi go test -race ./internal/hybridflow-runner/harnesses/pi/ -run '^TestPiReference'
```

Known limits and lifecycle requirements:

- `agent_end` is not final; the adapter waits for `agent_settled` and process cleanup.
- `abort` alone does not release an extension dialog parked in a tool hook. The adapter clears
  queues, cancels outstanding dialogs, then aborts, with a supervisor fallback deadline.
- RPC forks select user entries. A retained assistant anchor maps to the following user entry;
  whole branches use clone. The source is copied privately before any new settings are applied.
- OAuth concurrent refresh is not qualified and is rejected. API keys use explicit references.
- Only completed blocks are exposed. Terminal custom layouts, advanced extension management,
  sub-harness orchestration and plan mode are not advertised.
- A distant paid API and an independently deployed local model need operator-supplied access;
  these were unavailable in the implementation environment. Simulations cover the protocols,
  native/Docker execution and account isolation, rather than model quality or remote availability.

A new version must pass the same script on native Linux and Alpine, then the driver/browser tests,
before updating the shared Pi version in `core/equipment`, the install manifests and the UI.
