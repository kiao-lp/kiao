---
status: DRAFT
role: PRIMARY_SOURCE
---

# Static versions (`plugins/markdown-edit/StaticVersionPlugin.tsx`)

Part of the [Dashboard solution design](README.md).

**Generate static version** converts `name.src.md` into `name.md` plus `name.assets/`.
`markdown-edit` opens the source as ordinary Markdown. The generated copy replaces diagrams
with image links such as `![Diagram](name.assets/01-mermaid.svg)`, so standard Markdown viewers
can display them.

The naming convention is the contract; there is no manifest. Generation reads the source and
overwrites the output Markdown and asset directory. A source and its output can be moved or
renamed using ordinary file operations.

| Source | Responsibility |
| --- | --- |
| `staticVersion.ts` | Output and asset paths |
| `cms-core/markdown/static/generateStaticMarkdown` | Return generated Markdown and images; caller writes them |
| `fences.ts` | CommonMark fence walking, keeping diagrams quoted inside longer fences as examples |
| `intrinsicSize.ts` | Derive image dimensions from SVG viewBox rather than percentage widths |

If a diagram fails to render, retain its fenced source and report it. Never replace document
content with a blank or baked error image.

Generation is browser-side. It uses the loaded preview renderers: Mermaid, ArchDia, Graph and the configured PlantUML server. A server action requires headless rendering and deployment support. See the [decision](decisions/00014-static-version-in-browser.md).
