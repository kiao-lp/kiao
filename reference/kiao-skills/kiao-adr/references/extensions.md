---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Catalogue extensions to MADR

These conventions decorate the [MADR core](madr.md). They do not replace its headings
or native metadata.

## Catalogue metadata

All these YAML root fields are optional. Omit unknown values and empty attribution.

| Field | Content |
| --- | --- |
| `tags` | Unique topic and component names for human filtering. |
| `triggers` | Unique task situations and code identifiers indicating when an agent should read the record. They may name behaviors, symptoms, APIs, configuration keys or code symbols. |
| `owner` | A known accountable person or role; this does not identify the decision-makers. |
| `supersedes` | List of IDs replaced by this decision, in the same catalogue. |
| `superseded_by` | List of successor IDs, in the same catalogue; reciprocal to `supersedes`. |

For example, a proposed record with known topics and read triggers can start with:

```yaml
---
status: "proposed"
tags: ["configuration", "service"]
triggers: ["configuration defaults", "loadConfiguration"]
---
```

Here `status` is native MADR metadata; `tags` and `triggers` are catalogue extensions.
Write relationship IDs as strings, for example `supersedes: ["0042"]`, to preserve their spelling.
Use file links for cross-catalogue references because numbers alone are ambiguous.

## Identity and catalogue organization

The project chooses its catalogue locations and ID allocation scheme. The format fixes
neither the number of digits nor a starting value, chronological order or gap policy.
Keep these conventions in the project's catalogue index.

The filename starts with the catalogue ID followed by a descriptive slug. The H1 and
index entry share `ID — short title`. The filename supplies the ID and the H1 supplies
the title; neither needs a duplicate YAML field.

An index identifies the directories it covers and how new IDs are allocated. Several
directories may share one catalogue. Each entry links to its record and provides useful
read triggers. Keep metadata within the catalogue's scope.

## Updating records

Retain existing dates and filenames during format alignment: formatting alone does not
establish a new decision date. Substantive updates can record their known update date.

When a decision is replaced, retain the earlier record, mark its native status as
superseded, add body links in both records, and keep relationship lists reciprocal.
Before a deliberate deletion, preserve still-applicable rules and clear relationships
to removed records.

If catalogue cleanup deletes, renumbers or moves records, update filenames, H1s, index
entries, relationship metadata and inbound links together. Preserve existing IDs unless
the task explicitly calls for renumbering or the catalogue's conventions require it.
When moving a record to another catalogue, follow the target catalogue's identity rules
while preserving its date.
