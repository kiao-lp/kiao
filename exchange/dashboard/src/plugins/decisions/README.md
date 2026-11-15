---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Decisions

The Decisions panel lists the store's architecture decisions in one table.
The sources live in `kiao-user-config/decisions.json`:

```json
[
  { "path": "docs/solution-design/decisions" },
  { "path": "exchange/dashboard/docs/solution-design/decisions", "name": "Dashboard" }
]
```

Each source is a folder of decision files. `name` is optional; the folder
name is shown when it is absent. A missing file means no sources.

## Panels

| Panel | Reach | Content |
| --- | --- | --- |
| Decisions | Toolbar tab, persistent | Compact table of every decision |
| Decision sources | … menu | The source list: add, edit, delete |

Drop a folder from the file tree onto the sources panel to add it. Dropping
a file adds its folder. Edits save to the JSON file after a short delay;
there is no Save button.

## The table

Each `.md` file in a source folder gives one row: date, id, title, status,
tags and source. The record format is defined by
[kiao-adr](../../../../../reference/kiao-skills/kiao-adr/SKILL.md).
The parser reads root `status`, `date` and `tags`, the first H1 and the filename's
prefix. Missing fields stay empty; malformed YAML still allows the heading and
filename to display. Extra metadata is ignored.
The former `decision` namespace is not interpreted. Reading never rewrites a record.
The search box matches tags, status and source name. The Date
and ID headers sort in either direction; IDs use numeric order. Clicking
a title opens the file. Drag a row into a conversation, task or other file
target to use its decision file, just as when dragging from the file tree.

## ADR authoring

The `kiao-adr` skill is independent of this panel. The common
[skill installer](../../../../../reference/kiao-skills/README.md) delivers it to both
store agent directories even when `decisions` is disabled.
