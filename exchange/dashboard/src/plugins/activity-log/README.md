# Activity log

The Activity toolbar records work directly in the currently opened directory:

- `config.json` contains the reusable project list and reusable activity templates.
- `YYYY-MM-DD.actlog.jsonl` contains one JSON object per activity entry, based on the date chosen in the form.

Each entry has `date`, `project`, `durationMinutes`, and optional `description`
and `comment` fields. The comment is a long, multiline text area: newlines are
escaped inside the JSON line, so the log stays one JSON object per line.

## File labels

A daily log file spends its whole row on the day it records: the date, then a
proportion bar taking all the space left, then the day's total pinned to the
right. The bar always fills its track — one segment per project, sized by that
project's share of the day — so it reads as *how the day was split*, while *how
big the day was* is carried by the total. Totals are set in tabular figures in a
fixed slot, so they line up into a column down the table.

The per-project detail arrives three ways, in descending order of effort:

- **Written inside the segment**, as `Kiao 2:30`, whenever the segment is wide
  enough to hold the whole label. Segments too narrow are left bare rather than
  showing clipped text.
- **On hover**, as a tooltip covering the whole day: one row per project with its
  colour, time and share, plus the total. The tooltip sits on the bar rather than
  on each segment, so a three-minute entry stays reachable however thin its
  segment is; the pointer's position picks the row to emphasize, and opens
  underneath it what was done on that one project — a line per description with
  the time it took, longest first. A description logged twice in the day reads as
  one line carrying the whole time; time booked without a description keeps its
  own line, so the lines always add up to the project.
- **As the accessible name** of the bar, which lists every project and the total.

On narrow layouts — and in the grid view, which lives outside the folder table —
the bar is dropped and the label falls back to `2026-08-04 (4:00)`. The total is
never hidden.

## Project colours

`config.json` stores the colour of each project under `projectColors`:

```json
{
  "projects": ["Blog", "Docs", "Kiao"],
  "projectColors": { "Blog": "orange", "Docs": "aqua", "Kiao": "blue" }
}
```

The value is a *slot name*, not a hex, because the light and dark themes carry
different steps of the same hue; `ActivityLogBar.css` resolves the name per
theme. The eight slots are `blue`, `orange`, `aqua`, `yellow`, `magenta`,
`green`, `violet` and `red`, in that order — a categorical palette validated for
colour-blind separation and contrast against the folder table's own row colours.
A `#rrggbb` (or `#rgb`) in the same field is honoured as a manual override and
used as it stands in both themes.

Colours are assigned when an activity is logged: every project without one takes
the first slot no other project holds, and keeps it for good, so adding a project
never repaints the others. Configurations written before the bars existed are
filled in on the first save after that. A ninth project — and any project a log
mentions but the configuration does not list — is painted in the neutral grey,
which carries no identity; give it a hex in `config.json` to tell it apart.

The file list reads `config.json` once per folder and shares it across every row.

## Reusable templates

The "What was done" dropdown lists the descriptions of the saved templates. A
template stores the project, the time spent and the description — but no date.
Selecting a description in the dropdown loads the whole template (project, time
and description) into the form.

Saving a template is opt-in: tick **Save as reusable template** while logging
to store the current project/time/description combination in `config.json`, or
to replace an existing template with the same description. Configs created
before templates existed keep working: their plain `descriptions` strings are
loaded as templates without project or time.

## Timesheet export

The panel also offers **Download timesheet CSV**: it reads every `*.actlog.jsonl`
file in the opened folder and produces a CSV mirroring `Timesheets_Template.csv`
for the Q3 2026 reporting period (`2026-07-01` to `2026-09-30`). The export writes
`config.json`'s `resourceUnit` and `resourceName` into the first two columns — the panel
offers both above the download button and remembers them in the folder's config —
one row per project, and one column per day filled with the booked duration in
the template's `XhYY` format (e.g. `1h30`). Each day's logged time is scaled
proportionally to a fixed 7h 45m working day, rounded to multiples of 5
minutes; days without any logged time stay empty. Entries logged outside the
period are ignored, since they do not belong on that quarterly sheet.
