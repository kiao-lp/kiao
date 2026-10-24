# Markdown

The plugin opens `.md` files in the shared Markdown editor, with a source pane, rendered preview,
and PDF export through the browser's print dialog. The shared toolbar also downloads an editable
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
