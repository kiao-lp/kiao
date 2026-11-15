---
name: kiao-adr
description: Create, review or update decision records (ADRs), their metadata and catalogues using MADR 4.0.0 and optional catalogue extensions, including tags, triggers and supersession, in any project.
---

# kiao-adr

This skill defines a portable decision-record format for any project. It composes two
specifications without changing the MADR core:

| Specification | Defines |
| --- | --- |
| [MADR 4.0.0](references/madr.md) | Markdown structure and optional native metadata. |
| [Catalogue extensions](references/extensions.md) | Catalogue identity, tags, triggers, ownership and relationships. |

Read both when using the extended format. For a plain MADR record, use the MADR
specification. Follow the target project's catalogue conventions in either case.

## Authoring and review

Read the target catalogue's index, when present, for scope, directories and ID allocation. Open existing
records whose read triggers match the task before proposing a conflicting decision.
Write one record per decision; decisions need not concern architecture.

Tie the rationale to actual constraints and documented options. Do not invent alternatives,
acceptance, participants or verification results. If an existing record documents no
alternatives, list its recorded choice and state that other considered options were not
recorded. Leave unknown metadata absent. Ownership or authorship does not establish who
made the decision.

For an unresolved decision, state that the outcome is pending and distinguish a proposed
choice from an agreed one. Keep optional sections only when they convey useful information.

Before finishing, check that a chosen option appears among the candidates, the rationale
explains the choice, metadata agrees with the body, catalogue entries and relationships
are consistent, and unused placeholders are gone.
