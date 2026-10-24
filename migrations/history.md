# Maintained knowledge from retired base migrations

These are authoring contracts and source examples, not an upgrade runner. The original scripts are
in the [pre-cutover Git snapshot](cutover-2026-10-20.md). Modules under `examples/` export parsers or
pure transforms; they have no migration entry point. Packaging excludes
examples and tests. Do not copy them into the active set to upgrade an old store.

## Select documents deliberately

An extension is a candidate selector. Parse and validate the envelope, expected `docType`, collection
types and the exact old fields before writing. A bare legacy mindmap was accepted only when
`elements.notes` and `elements.relations` were arrays; an envelope declaring another `docType` was
rejected. Relations with fewer than two ends were removed; multiple ends became pairs centred on
the nearest measured note (first end if measurements were missing); attachment numbers outside
0–11 were dropped. Straight-line normalization removed relation routing and end-label fields,
reported label text for manual recovery, and preserved note shapes.

Known config locations can narrow selection further. V017 read only direct JSON children of
`kiao-user-config/values`, required an array and string `type`/`value` entries, and refused a
non-object `object`. Example:

```json
{"type":"Topic","value":"Rain","objective":"listen","__pinned":true}
```

became:

```json
{"type":"Topic","value":"Rain","object":{"objective":"listen"},"__pinned":true}
```

Root custom fields won over same-named nested fields because the reader used that precedence.
The [pure example](examples/value-shape.js) and [fixtures](test/retired-formats.json) retain this
conflict rule. Already-current entries cause no write, preserving formatting and modification times.

## Bound every walk and make interrupted runs recoverable

Use the common `.kiao-files` matcher for `[migration]`, including nested declarations. An ancestor's
exclusions cannot be undone. `.git` and `.kiao-config` are always excluded from content walks;
declared defaults protect build/dependency trees when a store has no declaration. Explicit state
adoption is a separate, narrowly named operation: V016 renamed only three known state documents;
V018 dropped only each file entry's `scroll` key in the two view-state documents, preserving access
stamps and all other scopes. Invalid JSON/shape was reported and retained.

Prepare and validate a whole output before deleting input. Renaming `qd-notes` → `docs` and
`config` → `kiao-user-config` did not overwrite occupied destinations. For new work, decide every
destination collision before any references change. Fix links before moving folders: an interrupted
retry can still reconstruct the same plan from the folders that have not moved. A folder moved
first loses that evidence. There is no filesystem/ledger transaction; fail loudly and keep partial
work retryable. A target already present is not permission to destroy either input.

V015 converted `### [title](link)` bookmarks into `{title,link,note}` JSON, using fence-aware sections.
Existing JSON won; markdown stayed for manual review when both existed. Preamble text was not a
bookmark, and a file without bookmarks did not create JSON. Schema-shape transforms must distinguish
“nothing to convert” from “an empty target to overwrite.”

## Rewrite links in their own context

`lib/link-fix.js` retains worker's leading-slash token boundary rules, raw/encoded spellings and
child suffixes. For a move `docs/id` → `docs/A title`:

| Before | After |
| --- | --- |
| `[page](/docs/id/page.md)` | `[page](/docs/A%20title/page.md)` |
| `"/docs/id/page.md"` in JSON | `"/docs/A title/page.md"` |
| `[page](docs/id/page.md)` | unchanged, document-relative |
| `cp docs/id /tmp` | unchanged, slashless prose/code |
| `/docs/id-extra` | unchanged, different path token |

V016's mount rename had a narrower scope than a store-path rename. It changed rendered Markdown
destinations (`[x](/quickcms/a.md)` → `[x](/dashboard/a.md)`), reference definitions, autolinks and
bare HTTP URLs; fenced/inline code, bare prose mentions, raw HTML attributes, templates and
`/quickcmsx` stayed unchanged. The [pure source example](examples/markdown-mount.js) and fixtures
retain those distinctions. Do not substitute a generic text replacement for context-aware parsing.

## Retired board transitions

The [legacy parser](examples/tasks-to-workflow.js) keeps headings inside fences in the body,
recognizes only flat YAML metadata immediately below a task heading, preserves unknown blocks,
retains meaningful column preambles and sorts numbered columns naturally. UUIDs gave columns/cards
identity independent of their labels. V006 filled only missing agent fields; an unfamiliar explicit
agent was retained. V009 made only a task's `settings.folder` store-absolute, leaving prose alone.
V010 flattened nested cards into a top-level list and attached column IDs without dropping existing
top-level cards. V013 renamed keys in place (`tasks` → `flowNodes`, `onSuccess.task` →
`onSuccess.flowNode`) and changed the known template directory/placeholders without reformatting
an already-current file.

V011 exported each board wholly or retained it wholly: deterministic IDs, one transaction, output
written before deleting only the exported inputs. Invalid cards, duplicate board names and the
known file template were not silently exported. V012 touched only V011-marked seed SQL with the
known statement shape: `on_success_mode='compact'` became `'continue'` plus
`on_success_compact=true`; other modes gained `false`. Do not rewrite arbitrary SQL or import a
file-store export automatically into PostgreSQL. The database's schema history is independent.

Regression coverage lives in `test/retired-formats.test.js`, the `.kiao-files` shared corpus,
link-fix tests and store-name corpus. They preserve document checks, retry behavior and link
boundaries without keeping the eighteen runnable migrations or their obsolete checksum pins.
