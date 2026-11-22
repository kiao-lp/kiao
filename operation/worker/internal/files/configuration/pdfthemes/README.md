# Markdown PDF themes

The PDF menu reads every `.json` file directly inside `kiao-user-config/pdf-themes/`.
The filename without `.json` identifies the theme, and `label` names it in the menu.
The menu reloads the files whenever it opens; no rebuild or restart is needed for custom themes.
Unreadable or invalid files are skipped. The neutral **Default** theme remains available even
when the folder is missing.

Worker synchronizes this README and `neutral.json` from its embedded defaults at every start,
replacing those filenames when their contents differ and restoring them when missing.
**To customize a delivered theme, copy it to another filename.** Other files are never overwritten
or removed by synchronization. The source of the delivered files is
`operation/worker/internal/files/configuration/pdfthemes/` in the KIAO distribution.

A theme inherits the exporter's neutral print layout (A4, typography, tables, code and diagrams)
and can override it with CSS custom properties and additional CSS:

```json
{
  "label": "My documents",
  "variables": {
    "--heading-1": "#174a7e",
    "--heading-2": "#24649b",
    "--link": "#174a7e",
    "--quote-bar": "#174a7e"
  },
  "css": "body { font-family: Arial, sans-serif; font-size: 12pt; } .pdf-header { margin-bottom: 1cm; }",
  "headerHtml": "<header class=\"pdf-header\"><strong>{{title}}</strong> — {{date}}</header>"
}
```

Only `label` is required. `variables` maps CSS custom property names (`--…`) to strings;
`css` is a string appended after the base print styles; `headerHtml` is an HTML string inserted
before the document. `{{title}}` and `{{date}}` (DD/MM/YYYY) are replaced with escaped text in
the header. The HTML and CSS themselves are authored as trusted store content.

`neutral.json` lists the palette variables. Layout can also be changed through `css`, including
`@page`, fonts, spacing, headers and the diagram height limits `--diagram-max-height` and
`--lone-diagram-max-height`. Mermaid and PlantUML are rendered with their light print palettes.
The document preview and the application theme are unaffected.

For a portable logo, use a `data:` URL in `headerHtml`, so the print tab needs no asset server.
Use absolute URLs for any other assets: the print tab does not resolve paths against the
original Markdown document.

The Word export offers the same files from an arrow beside its download button. Only the
palette paints the native Word document (text, headings, links, quotation border, table
headers, code, rules, as `#rgb`/`#rrggbb`/`black`/`white`); `css` and `headerHtml` stay
PDF-only.
