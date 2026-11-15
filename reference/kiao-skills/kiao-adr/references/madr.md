---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# MADR 4.0.0 — core format

MADR means **Markdown Architectural Decision Records**, formerly **Markdown Any Decision
Records**, and can describe any decision. This specification follows the versioned
[MADR 4.0.0 templates](https://github.com/adr/madr/tree/4.0.0/template).
Optional catalogue metadata is specified separately in [Catalogue extensions](extensions.md).

## Required structure

Use a short H1 and these three H2 sections in order:

```markdown
# {Short title describing the problem or solution}

## Context and Problem Statement

{Why a decision is needed and the relevant constraints.}

## Considered Options

* {Option A}
* {Option B}

## Decision Outcome

Chosen option: "{Option A}", because {reason for choosing it}.
```

The [minimal upstream template](https://github.com/adr/madr/blob/4.0.0/template/adr-template-minimal.md)
provides this structure. The number of options depends on the recorded decision;
include the status quo when it was considered.

## Optional elements

| Element | Placement and content |
| --- | --- |
| YAML front matter | Before H1; native fields are defined below. |
| `## Decision Drivers` | Before options: constraints, quality goals and priorities that determine the choice. |
| `### Consequences` | Under outcome: effects of the chosen option using `Good, because …` and `Bad, because …`. |
| `### Confirmation` | Under outcome, after consequences if present: how a review, test or measurement checks compliance. Distinguish planned checks from results. |
| `## Pros and Cons of the Options` | After outcome: one `### {Option}` per candidate, with `Good, because …`, `Bad, because …` and optionally `Neutral, because …` arguments. A description, example or supporting link may precede the arguments. |
| `## More Information` | Last: evidence, related records, agreement, implementation or revisit conditions. |

## Native metadata

All native fields are optional and live at the YAML root:

| Field | Content |
| --- | --- |
| `status` | A quoted string, for example `"proposed"`, `"accepted"`, `"rejected"`, `"deprecated"` or `"superseded by ADR-0123"`. These are examples, not a closed enumeration. |
| `date` | Last update date, when known, in `YYYY-MM-DD` form. |
| `decision-makers` | Recorded people involved in making the decision. |
| `consulted` | People whose opinions were sought through two-way communication. |
| `informed` | People kept up to date through one-way communication. |

Keep native fields at the root when adding project extensions. Put links to related and
superseding records in the body.
