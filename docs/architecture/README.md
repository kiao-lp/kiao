# Architecture

## Preliminaries

We reserve **architecture** for solution-agnostic documentation. We use **solution design**
for documentation that is solution-specific, supports implementation reviews, or provides
implementation guidance.

Architecture documentation is centralized in [architecture](./README.md). Global solution
designs involving multiple systems are stored in [solution-design](../solution-design/README.md).
Each system-specific solution design is stored within its corresponding container, under
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

## Architecture documentation

[Principles](./principles.md) describes functional boundaries, responsibility zones, dependency
direction and state ownership without choosing technologies, containers or deployment targets.

The four views in `domain-views/` form a concise logical baseline of the base distribution, reviewed on
2026-10-24 against revision `6a296e29` and the owner's discovery answers. Their organization is
TOGAF-inspired: Business, Data, Application and Technology. The Open Group's
[architecture overview](https://www.opengroup.org/soa/source-book/togaf/p4.htm) places Data and
Application together under Information Systems; here **Information Systems** names the application
view, with Data documented separately. This is a lightweight use of those viewpoints.

| View | Owns | Catalog identifiers |
| --- | --- | --- |
| [Business](./domain-views/Business.md) | Outcomes, capabilities, roles, value streams and business decision rights. | B — business capabilities |
| [Data](./domain-views/Data.md) | Conceptual information, authority, provenance, lifecycle and information-policy placeholders. | D — information sets |
| [Information Systems](./domain-views/Information%20Systems.md) | Logical application services, capability realization and collaborations across responsibility zones. | A — application services |
| [Technology](./domain-views/Technology.md) | Supporting infrastructure services, application dependencies, technical constraints and operating-requirement placeholders. | T — technology services |

The catalogs synthesize delivered responsibilities independently of runnable components. Owner
answers confirm purpose and principles; undecided policies and numeric targets remain explicitly
**unspecified**. These views do not prescribe new deployments or imply that a desired policy is
already enforced.

The installation owner decides business intent, information handling and operating expectations.
Maintainers update the owning catalog and affected cross-domain matrices when accepted changes
alter the baseline. Keep each definition in its owning page and link to it; concrete mappings and
procedures remain in their solution designs and manuals.

## Solution designs

The [solution design index](../solution-design/README.md) is the entry point for the implemented
solution, proposed changes, implementation reviews and decision records. It links to global
designs and to each container's local documentation.
