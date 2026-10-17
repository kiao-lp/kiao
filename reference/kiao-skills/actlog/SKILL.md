---
name: actlog
description: This skill should be used when the user asks to "log an activity", "add a time entry", "modify a .actlog.jsonl file", "record time spent on a project", "fix a logged duration", "add a project to the activity log", "change a project colour", "add an activity template", "edit the activity log config", or works with .actlog.jsonl files, activity logs, timesheets, or time tracking in a folder.
---

# ActLog — Daily Activity Logs

An activity log records time spent, day by day, in the folder it is kept in. Two kinds of file make it up:

| File | What it holds |
|------|---------------|
| `YYYY-MM-DD.actlog.jsonl` | One day's entries, **one JSON object per line** |
| `config.json` | The folder's reusable project list, activity templates and project colours |

Both live directly in the folder being browsed; a folder may hold as many daily logs as it has days. The file listing shows each day as a proportion bar split by project, with the day's total pinned to the right.

## Daily Log Format

`2026-08-04.actlog.jsonl`:

```jsonl
{"date":"2026-08-04","project":"Kiao","durationMinutes":150,"description":"Board settings"}
{"date":"2026-08-04","project":"Docs","durationMinutes":45,"description":"Release note","comment":"Rewrote the intro;\nthe rest stands."}
{"date":"2026-08-04","project":"Kiao","durationMinutes":45}
```

**JSON Lines, strictly**: one complete JSON object per line, no wrapping array, no pretty-printing, no trailing commas. Blank lines are ignored. A line that does not parse, or that fails the rules below, is **silently skipped** — the log still opens, and the time on that line simply does not count.

### Entry Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `date` | string | Yes | The activity's date, `YYYY-MM-DD`. Normally the same date as the file name |
| `project` | string | Yes | Project name, non-empty once trimmed. Matched literally against `config.json`'s list and colours |
| `durationMinutes` | number | Yes | Time booked, **in minutes**, finite and greater than zero. Rounded to a whole number when read |
| `description` | string | No | One line: what was done. This is what activity templates are keyed by |
| `comment` | string | No | A long, multiline note. Newlines are `\n` escapes, so the entry stays one line |

A line is dropped when `date` is missing or not a string, when `project` is missing or blank, or when `durationMinutes` is absent, not a number, or `≤ 0`.

Several entries may share a project within a day; they are added together for the bar and the total.

### The File Name and the `date` Field

The row's label comes from the **file name**, and the day's total from **every line in the file**, whatever each line's `date` says. The timesheet export, on the other hand, groups by each entry's own `date`. Keep the two in agreement, or a line counts toward one day on screen and another in the export.

## `config.json` Format

```json
{
  "projects": ["Blog", "Docs", "Kiao"],
  "projectColors": { "Blog": "orange", "Docs": "aqua", "Kiao": "blue" },
  "templates": [
    { "project": "Kiao", "durationMinutes": 60, "description": "Daily review" },
    { "description": "Meeting" }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `projects` | string[] | The project names offered when logging. Trimmed, deduplicated and sorted on read |
| `projectColors` | object | Project name → colour. Entries naming neither a palette slot nor a hex are dropped |
| `templates` | object[] | Reusable presets. Deduplicated by `description` and sorted by it |
| `resourceUnit` | string | **Optional.** Whose timesheet the CSV export is: written into its first column |
| `resourceName` | string | **Optional.** The same, second column. Both are blank until set in the panel |
| `descriptions` | string[] | **Legacy.** Plain description strings from before templates existed; read as templates with no project or time, and only when `templates` is absent or empty |

A folder with no `config.json` is a folder that has never logged anything — that is the normal first-run state, not an error. An unreadable or non-object file reads as empty configuration.

### Template Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | Yes | Non-empty. The key: two templates cannot share one, and the panel's dropdown lists these |
| `project` | string | No | Loaded into the form with the description |
| `durationMinutes` | number | No | Loaded too. Must be a finite number greater than zero |

A template carries no date — that is what makes it reusable.

### Project Colours

A project's colour is a **slot name**, not a hex, because the light and dark themes use different steps of the same hue and only the name survives. The eight slots, in palette order:

`blue`, `orange`, `aqua`, `yellow`, `magenta`, `green`, `violet`, `red`

They are a categorical palette validated for colour-blind separation and for contrast against the folder table's own row colours.

- A **`#rrggbb` or `#rgb`** in the same field is honoured as a manual override and used verbatim in both themes. The label written on the segment picks black or white ink by luminance.
- **`other`** is the neutral grey. It carries no identity and is what a ninth project — and any project a log mentions but `config.json` does not list — is painted with. Give such a project a hex to tell it apart.
- Colours are assigned when an activity is logged: a project without one takes **the first slot no other project holds**, in palette order, and keeps it for good. Adding a project never repaints the others.
- A value that is neither a slot, `other`, nor a valid hex is dropped on read, and the project falls back to the neutral grey.

## Timesheet Export

The panel's **Download timesheet CSV** reads every `*.actlog.jsonl` in the folder and produces one row per project with one column per day, over a fixed reporting period (`2026-07-01` to `2026-09-30`). Each day's logged time is scaled proportionally to a **7h 45m** working day, rounded to multiples of **5 minutes**, and written in the template's `1h30` form. Days with nothing logged stay empty; entries dated outside the period are ignored.

This shapes what a log is worth writing: what matters for the export is the **proportion** between projects on a day, not the absolute total.

## Complete Example

A folder tracking two projects over three days:

```
timesheet/
  config.json
  2026-08-03.actlog.jsonl
  2026-08-04.actlog.jsonl
  2026-08-05.actlog.jsonl
```

`config.json`:

```json
{
  "projects": ["Docs", "Kiao"],
  "projectColors": { "Docs": "orange", "Kiao": "blue" },
  "templates": [
    { "project": "Kiao", "durationMinutes": 30, "description": "Backlog grooming" }
  ]
}
```

`2026-08-04.actlog.jsonl`:

```jsonl
{"date":"2026-08-04","project":"Kiao","durationMinutes":150,"description":"Board settings"}
{"date":"2026-08-04","project":"Kiao","durationMinutes":30,"description":"Backlog grooming"}
{"date":"2026-08-04","project":"Docs","durationMinutes":60,"description":"Release note","comment":"Rewrote the intro.\nThe rest stands."}
```

That day reads as 4h 00m, split 75% Kiao / 25% Docs.

## Editing Guidelines

### Logging an Activity

Append one line to `YYYY-MM-DD.actlog.jsonl` for the day, creating the file if it is not there. Duration is in minutes: 2h 30m is `150`. The form accepts `90m`, `1h 30m`, `1.5h` and `2:30`, but only minutes are ever stored.

### Correcting an Entry

Edit the line in place. Keep it a single line — a comment's newlines stay as `\n` escapes.

### Removing an Entry

Delete its whole line. Leaving a blank line behind is harmless.

### Adding a Project

Add the name to `projects` in `config.json`, and give it a colour in `projectColors` — the first palette slot no other project holds. A project logged but never listed is painted the neutral grey.

### Recolouring a Project

Change its value in `projectColors` to another slot name, or to a `#rrggbb` override. Check no other project already holds the slot, or two will look alike.

### Adding a Template

Append an object to `templates` with a `description` no other template uses, plus the `project` and `durationMinutes` it should load.

### Starting a Log in a New Folder

Create the first `YYYY-MM-DD.actlog.jsonl` with its entries, and a `config.json` listing the projects used, with a colour each. Nothing else is needed.

## Common Mistakes to Avoid

- **Pretty-printing the log** — an entry spread over several lines parses as nothing, and its time silently vanishes from the day. One object, one line.
- **Wrapping the entries in a JSON array** — the file is JSON Lines, not JSON.
- **Writing a duration as text** — `"1h30"` or `"90m"` in `durationMinutes` fails the number check and the line is dropped. Write `90`.
- **Writing duration in hours** — `durationMinutes: 1.5` is ninety *seconds* short of two minutes, not an hour and a half.
- **Zero or negative durations** — dropped on read.
- **A real newline inside `comment`** — it splits the entry across lines and both halves fail to parse. Escape as `\n`.
- **A `date` that disagrees with the file name** — the day's bar and the timesheet then count it differently.
- **A misspelt or untrimmed project name** — matching is literal, so `"Kiao "` is a different project from `"Kiao"`, with its own colour and its own bar segment.
- **Two projects sharing a colour slot** — nothing rejects it, and the bar becomes unreadable.
- **A colour that is neither a slot nor a hex** — `"lightblue"` is dropped and the project turns grey. The eight slot names are the whole list.
- **Two templates with the same `description`** — the second is dropped; description is the key.
- **Expecting a missing `config.json` to be an error** — it is not, and nothing needs to create one until a project or colour is worth recording.
