---
document:
  status: EXPERIMENTAL
  role: PRIMARY_SOURCE
---

# Architecture

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

The [DCMS concept catalog](./data/dcms-concept-catalog.md) defines the document at the core of
document management and distinguishes it from content intended for publication or distribution.
The [conversation data architecture](./data/conversation.md) defines the target information
model for harness-independent continuation and asynchronous inspection of remote executions.

The catalogs synthesize delivered responsibilities independently of runnable components. Owner
answers confirm purpose and principles; undecided policies and numeric targets remain explicitly
**unspecified**. These views do not prescribe new deployments or imply that a desired policy is
already enforced.

The installation owner decides business intent, information handling and operating expectations.
Maintainers update the owning catalog and affected cross-domain matrices when accepted changes
alter the baseline. Keep each definition in its owning page and link to it; concrete mappings and
procedures remain in their solution designs and manuals.
