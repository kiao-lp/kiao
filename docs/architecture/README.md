---
status: APPROVED
role: PRIMARY_SOURCE
---

# Architecture preliminaries

## Scope

We reserve **architecture** for solution-agnostic documentation. We use **solution design**
for documentation that is solution-specific, supports implementation reviews, or provides
implementation guidance.

Architecture documentation is kept in this directory. Global solution designs involving
multiple systems are stored in [solution-design](../solution-design/README.md). Each
system-specific solution design is stored within its corresponding container, under
`.../docs/solution-design`, and referenced from the central
[solution-design index](../solution-design/README.md).

The scope determines ownership: a document about one container belongs with that container;
a document spanning containers belongs in the global solution design area. Keep one authoritative
copy and link to it. Package READMEs, API references and user instructions remain beside the
code or in their respective manuals; their design rationale belongs in the relevant solution design.

All references within this repository must resolve within it when opened independently.
Use document-relative links or paths rooted at this repository's root, without a monorepo prefix
or traversal outside the repository. See the
[documentation decision](../solution-design/decisions/00077-architecture-and-solution-design.md).

## Solution designs

The [solution design index](../solution-design/README.md) is the entry point for the implemented
solution, proposed changes, implementation reviews and decision records. It links to global
designs and to each container's local documentation.

## Domain concepts

The [DCMS concept catalog](./data/dcms-concept-catalog.md) defines documents and content.
Documents are the central information artifacts managed by DCMS; content has an intended
publication or distribution purpose.
