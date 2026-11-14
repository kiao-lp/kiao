---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Activity log

The Activity toolbar records work in the open directory. `config.json` holds projects, colors
and reusable templates; `YYYY-MM-DD.actlog.jsonl` holds one JSON entry per activity on the chosen
date. Entries contain `date`, `project`, `durationMinutes` and optional `description` and
multiline `comment`. Newlines are escaped so each entry stays on one JSON line.

## File labels

Daily file rows show date, a project-share bar filling the remaining space, and a right-aligned
total in tabular figures. Each segment's width represents its share of that day's logged time,
not absolute hours. Project detail is available through:

- Segment labels such as `Docs 2:30`, only when the full label fits.
- A whole-bar tooltip with project color, duration, share and daily total. Pointer position
  highlights a project and reveals descriptions ordered by duration. Repeated descriptions
  combine; undescribed time has its own line, so the breakdown matches the project total.
- The bar's accessible name, listing projects and total.

Narrow layouts and grid view omit the bar and use a label such as `2026-08-04 (4:00)`.
The total remains visible.

## Project colours

```json
{
  "projects": ["Blog", "Docs", "Kiao"],
  "projectColors": { "Blog": "orange", "Docs": "aqua", "Kiao": "blue" }
}
```

Slot names map to theme-specific colors in `ActivityLogBar.css`. The eight slots are `blue`,
`orange`, `aqua`, `yellow`, `magenta`, `green`, `violet`, `red`. Hex overrides (`#rgb` or
`#rrggbb`) use the same value in both themes.

On logging, each uncolored project gets the first unused slot and keeps it. Configs missing colors fill on save. A ninth project, or a logged project absent from configuration, shows neutral grey without a hex override. Adding projects never recolors existing ones. The file list reads configuration once per folder and shares it across rows.

## Reusable templates

The What was done dropdown lists saved templates. Selecting one fills project, duration and description, without a date. Tick **Save as reusable template** while logging to save those fields or replace the template with the same description. Plain `descriptions` strings load as templates without project or duration.

## Timesheet export

**Download timesheet CSV** reads the open folder's `*.actlog.jsonl` files and produces the
`Timesheets_Template.csv` layout for the fixed **Q3 2026** period, July 1–September 30.
`resourceUnit` and `resourceName` supply the first columns and are editable above the button,
persisted in the folder config. The output has one row per project and one column per day.

Durations use `XhYY`, such as `1h30`. Each nonempty day scales proportionally to **7h45m** and
rounds to five-minute increments. Empty days stay empty; entries outside the period are ignored.
