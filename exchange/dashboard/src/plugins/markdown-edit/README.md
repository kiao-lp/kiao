---
status: DRAFT
role: PRIMARY_SOURCE
---

# Markdown

Opens `.md` files with source, preview and export controls.

## Document metadata

The document panel bar has **Status** (`DRAFT`, `EXPERIMENTAL`, `APPROVED`) and **Role**
(`PRIMARY_SOURCE`, `DERIVED`) dropdowns. They read and update the document's YAML front matter.
Picking either role opens **Document provenance**, where the provenance description can be
edited for either role. Pick the current role again to reopen it. Changes autosave with the
source editor; closing the dialog keeps them.

**Skill definitions (`SKILL.md`) must not have `status` or `role` in their YAML front matter.**
These keys are rejected by skill validators. Leave both selectors empty for these files; if
either key is already present, remove it in the source pane while preserving the skill's
supported fields (such as `name`, `description` and `metadata`).

Files without metadata show empty selectors until a value is chosen. Metadata edits preserve
the Markdown body, other YAML fields and comments. Invalid YAML or a non-mapping header disables
the selectors with an explanation; fix it in the source pane to continue. Source edits and
changes on disk update the selectors too.

YAML front matter stays visible and editable in the source pane, and is hidden in rendered
previews and PDF/Word exports. Preview source positions still refer to the complete source file.

## Exports

The shared Markdown toolbar prints PDF through the browser dialog and downloads an editable
Word document (`.docx`) from the current source, including unsaved edits, even with the preview
hidden. Diagram SVGs and PNG compatibility previews are embedded alongside native Word text,
headings, lists, tables, links, code and images. Generation reports progress and stops explicitly
if a diagram or image cannot be included. Word downloads neutrally at once; an arrow
beside the button offers the same store themes as the PDF menu, whose palette paints the
native Word styles while their CSS and header stay PDF-only.

See the [Word export design and compatibility](../../../docs/solution-design/decisions/00068-markdown-word-export.md)
and [Word themes](../../../docs/solution-design/decisions/00069-word-export-themes.md).

The PDF menu loads themes from `kiao-user-config/pdf-themes/` on each opening. Worker installs
and synchronizes the delivered neutral theme at startup. Custom themes can supply colors, CSS,
and an HTML header, without rebuilding Dashboard or changing the document preview.

See the [theme format and synchronization rules](../../../../../operation/worker/internal/files/configuration/pdfthemes/README.md).
Copy a delivered theme to a new filename before customizing it; delivered filenames are refreshed
at every worker start.

## Companion skills

Enabling `markdown-edit` installs three agent skills from the worker's
[skill catalogue](../../../../../reference/kiao-skills/README.md): `markdown-metadata` for
document status, role and provenance, `markdown-anchors` for heading links and tables of
contents, and `markdown-passage-link` for links to quoted passages. Disabling the plugin
removes their managed copies from the store's `.agents/skills/` and `.claude/skills/`.
