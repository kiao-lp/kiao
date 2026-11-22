---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-09-08
tags: ["import-gate", "security", "store", "worker", "dashboard"]
triggers: ["sensitive data", "regex rule", "false positive", "new category", "criticality", "underline shape", "deleted category returns", "navigator"]
supersedes: []
superseded_by: []
---

# 00031 — Sensitivity rules store-owned JSON, matching in browser.

## Context and Problem Statement

Sensitivity rules need tuning to each store's documents and must work on first use.
Compiling rules into the build prevents that tuning; restoring deleted categories would
undo the owner's choices.

## Considered Options

* Seed a store-owned JSON rule catalogue once and match in the browser.
* Compile sensitivity rules into the application build.
* Restore each missing bundled category at every startup.

## Decision Outcome

Chosen option: "Seed a store-owned JSON rule catalogue once and match in the browser",
because the owner can inspect, edit, version and transport rules without a release.

`kiao-user-config/import-gate/` holds one JSON file per category, listing named regular
expressions and criticality. Dashboard reads it through the file API, scans reviewed text,
paints findings and offers a navigator. Stores can add patterns such as `DOSSIER-\d{4}`.

Worker embeds a starting catalogue for credentials and keys, classification markings,
article-9 data, personal identifiers, bank/payment data, HR records, network topology,
contracts and IP. It seeds only an absent folder, serving all four launch modes without
a copy step.

Four criticality levels determine color, underline shape and the navigator's label.
Overlapping findings retain the most severe level, such as a GitHub token also matching
a password pattern. Detection favors finding potential secrets over avoiding every false
positive: review is cheaper than credential rotation.

Failure is localized: an absent folder gives an empty gate, invalid category JSON removes
that category, and an invalid pattern removes only that rule.

### Consequences

* Bad, because later bundled categories must be copied manually or the folder deleted
  for reseeding; deliberately deleted categories remain deleted.
* Bad, because recall comes at a precision cost. Patterns were narrowed against actual
  repository prose rather than matching topic words alone.

### Confirmation

The catalogue's suite uses the browser's regular-expression engine.
