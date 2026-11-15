---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Observe and diagnose

Read for change feeds, usage totals or deployment diagnosis. Ordinary edits use the read-back
checks in [operations](../operations.md).

`board_changes` reads changes after the saved `cursor`. Filter `board` with the board's **id**,
not its slug. Keep the returned cursor; when `more` is true, fetch the next page from it. Each
event records sequence, time, actor, scope, kind, affected ids and revision. Routine edits normally
need a read back rather than polling. HTTP can additionally wait for a change; see [api-curl](../api-curl.md).

`board_card_usage` returns accumulated reports, input/output/cache/reasoning token counts and
`costUsdMicros` where known. Missing cost means unknown, not zero. `hybridflow_schema` reads
the migration ledger for deployment diagnosis; it does not describe card fields or JSON Schemas.
