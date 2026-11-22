---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Config documents

← [worker wire protocol](/operation/worker/PROTOCOL.md).

`GET`/`PUT /config/{name}` read and replace whole JSON documents in the worker's
[operational state directory](../docs/solution-design/state.md). Deployment environment
variables are documented separately in [Configuration](../docs/solution-design/configuration.md).

| Method | Path | Query / body | Response |
| --- | --- | --- | --- |
| GET | `/config/{name}` | — | the document, verbatim JSON |
| PUT | `/config/{name}` | the document as JSON | `204` |

## Allowed documents

`{name}` is an allowlist of exactly four names:

| Name | Purpose |
| --- | --- |
| `dashboard.json` | Hand-edited Dashboard feature flags and plugin selection. |
| `dashboard-view-state.json` | How the UI was left on a roomy viewport, rewritten as panes are arranged. |
| `dashboard-view-state-small.json` | The same UI state for a small viewport; layout is selected by screen size. |
| `runner.json` | Runner identity, `{ "runnerId": "…" }`, written by the runners panel's “it's me” button. |

The client owns each document's schema; worker validates JSON syntax and stores the supplied
bytes. An unknown name is `404`, as is a document that has never been written; clients seed
their defaults on that response. Invalid JSON or a body over 1 MiB is `400`.

The allowlist protects the migration ledger and conversation registry beside these documents.
The [state isolation contract](../docs/solution-design/state.md#service-state) describes file-API
exclusion (`400`), omission from listings and the seeded `.gitignore` that keeps state out of
Source Control and published stores.

## Save effects

The HTTP adapter replaces configuration documents atomically. A `runner.json` save adopts the
runner identity before returning `204`. The next heartbeat and Play use that identity, subject to
the `KIAO_WORKER_RUNNER_ID` override. [Save handler](../internal/files/http/configdocs.go),
[deployment configuration](../docs/solution-design/configuration.md)

Dashboard owns viewport selection and view-state persistence.
[View-state design](/exchange/dashboard/src/core/view-state/docs/solution-design/view-state.md)
