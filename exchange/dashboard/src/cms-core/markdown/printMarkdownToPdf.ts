import mermaid from 'mermaid';
import plantumlEncoder from 'plantuml-encoder';
import { kiaoPlantUMLPdf, injectPlantUMLTheme } from 'kiao-style';
import { configureMermaid } from './lib/mermaid';
import { buildPdfThemeCss, renderPdfThemeHeader, type PdfTheme } from './pdfThemes';

export interface PrintPdfOptions {
    title: string;
    /**
     * Default PlantUML server URL when no `<img>` element exposes one.
     * Useful in environments where PlantUML images come from a proxied path.
     */
    plantUmlServerUrl?: string;
    /**
     * Store theme for the generated PDF. Uses the neutral base style when omitted.
     */
    theme?: PdfTheme;
}

async function rerenderMermaidLight(clone: HTMLElement): Promise<void> {
    const diagrams = clone.querySelectorAll<HTMLElement>('.mermaid[data-mermaid-source]');
    if (diagrams.length === 0) return;

    // Always light: this is the copy going on paper, whatever the application is wearing.
    configureMermaid('light');

    let idx = 0;
    for (const el of Array.from(diagrams)) {
        const source = el.getAttribute('data-mermaid-source');
        if (!source) continue;
        try {
            const { svg } = await mermaid.render(`mermaid-pdf-${idx++}`, source);
            el.innerHTML = svg;
        } catch (_) {
            // keep the dark-rendered SVG as fallback
        }
    }
}

function rerenderPlantUMLForPrint(clone: HTMLElement, fallbackServerUrl?: string): void {
    const images = clone.querySelectorAll<HTMLImageElement>('img[data-plantuml-source]');
    for (const img of Array.from(images)) {
        const source = img.getAttribute('data-plantuml-source');
        if (!source) continue;
        try {
            const themed = injectPlantUMLTheme(source, kiaoPlantUMLPdf);
            const encoded = plantumlEncoder.encode(themed);
            const oldSrc = img.src;
            const svgIdx = oldSrc.lastIndexOf('/svg/');
            const baseUrl = svgIdx !== -1
                ? oldSrc.slice(0, svgIdx)
                : (fallbackServerUrl || 'https://www.plantuml.com/plantuml');
            img.src = `${baseUrl}/svg/${encoded}`;
        } catch (_) {
            // keep the original image as fallback
        }
    }
}

const HEADINGS = 'h1, h2, h3, h4, h5, h6';

/**
 * The element holding the top-level markdown blocks — the container passed in
 * wraps them in a div of its own, and a heading nested in a blockquote or a
 * diagram is not one of them. Taken as the parent of the shallowest heading;
 * null when the document has no heading to group around.
 */
function findBlockHost(clone: HTMLElement): HTMLElement | null {
    let host: HTMLElement | null = null;
    let shallowest = Infinity;
    for (const heading of Array.from(clone.querySelectorAll<HTMLElement>(HEADINGS))) {
        let depth = 0;
        for (let p = heading.parentElement; p && p !== clone; p = p.parentElement) depth++;
        if (depth < shallowest) {
            shallowest = depth;
            host = heading.parentElement;
        }
    }
    return host;
}

/**
 * Wraps every heading and the blocks that follow it in a `<section>`, so the
 * stylesheet can keep a heading, its intro and its diagram on the same page.
 * A heading of any level opens a new section; blocks before the first one are
 * left where they are.
 */
function groupHeadingSections(clone: HTMLElement): void {
    const host = findBlockHost(clone);
    if (!host) return;

    let section: HTMLElement | null = null;
    for (const block of Array.from(host.children)) {
        if (block.matches(HEADINGS)) {
            section = host.ownerDocument.createElement('section');
            section.className = 'pdf-section';
            host.insertBefore(section, block);
        }
        section?.appendChild(block);
    }
}

function collectKatexStyles(): string {
    const rules: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
        try {
            for (const rule of Array.from(sheet.cssRules)) {
                const text = rule.cssText;
                if (text.includes('katex') || text.includes('KaTeX')) {
                    rules.push(text);
                }
            }
        } catch (_) {
            // Skip cross-origin stylesheets
        }
    }
    return rules.join('\n');
}

export async function printMarkdownToPdf(contentElement: HTMLElement, options: PrintPdfOptions): Promise<void> {
    const { title, plantUmlServerUrl, theme } = options;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Please allow pop-ups to download PDF.');
        return;
    }

    const katexStyles = collectKatexStyles();

    const clone = contentElement.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('button, [class*="toolbar" i], [class*="Toolbar"], .code-copy-btn, .copy-html-btn').forEach(el => el.remove());

    clone.querySelectorAll('.archdia-viewer-container').forEach(el => {
        el.classList.add('archdia-theme-light');
    });

    await rerenderMermaidLight(clone);
    rerenderPlantUMLForPrint(clone, plantUmlServerUrl);
    groupHeadingSections(clone);

    const html = clone.innerHTML;
    const escaped = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escaped}</title>
<style>
@page {
    margin: 1cm;
    size: A4;
}

:root {
    --bg: white;
    --text: #1a1a1a;
    --border: #999;
    --muted: #666;
    --link: #1a1a1a;
    --accent-bg: #f0f0f0;
    --diagram-box-fill: #e8eaf0;
    --input-bg: #f5f5f5;
    --heading-1: #1a1a1a;
    --heading-2: #2a2a2a;
    --heading-3: #3a3a3a;
    --heading-4: #4a4a4a;
    --heading-5: #555;
    --heading-6: #666;
    --hr-color: #ccc;
    --quote-bar: #999;
}

/* A4 minus the 1cm @page margin leaves a 19 x 27.7cm content box. Diagrams are
   sized in CSS pixels by the PlantUML/Mermaid renderer and routinely come out
   16-27cm tall, which leaves no room on the page for the heading and intro they
   belong to. Capping their height keeps a section together; a section that is
   nothing but a heading and its diagram gets the rest of the page. */
:root {
    --diagram-max-height: 19cm;
    --lone-diagram-max-height: 24.5cm;
}

* { box-sizing: border-box; }

body {
    font-family: 'Georgia', 'Times New Roman', 'Noto Serif', serif;
    font-size: 14pt;
    line-height: 1.7;
    color: #1a1a1a;
    background: white;
    max-width: 100%;
    padding: 0;
    margin: 0;
}

/* On-screen staging tab: mimic the A4 page so margins are visible before printing.
   Print margins come from @page above; these screen rules are ignored when printing.
   Placed after the base body rule so they win on equal specificity. */
@media screen {
    html { background: #f5f5f5; }
    body {
        max-width: 21cm;
        margin: 1cm auto;
        padding: 1cm;
        box-shadow: 0 0 10px rgba(0, 0, 0, 0.15);
    }
}

h1 { font-size: 26pt; margin: 1.2em 0 0.5em; page-break-after: avoid; color: var(--heading-1); }
h2 { font-size: 21pt; margin: 1em 0 0.4em; page-break-after: avoid; color: var(--heading-2); }
h3 { font-size: 18pt; margin: 0.8em 0 0.3em; page-break-after: avoid; color: var(--heading-3); }
h4 { font-size: 16pt; margin: 0.6em 0 0.3em; page-break-after: avoid; color: var(--heading-4); }
h5 { font-size: 14pt; font-weight: bold; margin: 0.5em 0 0.3em; page-break-after: avoid; color: var(--heading-5); }
h6 { font-size: 14pt; font-weight: bold; margin: 0.5em 0 0.3em; page-break-after: avoid; color: var(--heading-6); }

p { margin: 0.5em 0; orphans: 3; widows: 3; }

img {
    max-width: 100%;
    max-height: var(--diagram-max-height);
    height: auto;
    /* An image carrying an authored width keeps it when the cap bites, so let
       it letterbox rather than stretch. */
    object-fit: contain;
    page-break-inside: avoid;
    display: block;
    margin: 0.5em auto;
}

svg {
    max-width: 100%;
    max-height: var(--diagram-max-height);
    height: auto;
    page-break-inside: avoid;
    /* A diagram narrower than the page sits centered on it, the way an image
       in the same document does (see the img rule above). */
    display: block;
    margin: 0.5em auto;
}

/* Keep a heading with the text and the diagram that belong to it. Dropped by
   the browser when a section is too tall to fit a page anyway. */
.pdf-section {
    page-break-inside: avoid;
    break-inside: avoid;
}

.pdf-section:not(:has(p, ul, ol, table, pre, blockquote)) img,
.pdf-section:not(:has(p, ul, ol, table, pre, blockquote)) svg {
    max-height: var(--lone-diagram-max-height);
}

pre, code {
    font-family: 'Courier New', 'Courier', monospace;
    font-size: 10pt;
}

pre {
    background: #f5f5f5;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 12px;
    page-break-inside: avoid;
    white-space: pre-wrap;
    word-wrap: break-word;
    margin: 0.8em 0;
}

code {
    background: #f0f0f0;
    padding: 1px 4px;
    border-radius: 3px;
}

pre code {
    border: none;
    padding: 0;
    background: none;
}

table {
    border-collapse: collapse;
    width: 100%;
    margin: 1em 0;
    page-break-inside: avoid;
    font-size: 12pt;
}

th, td {
    border: 1px solid #999;
    padding: 8px 12px;
    text-align: left;
}

th {
    background: #f0f0f0;
    font-weight: bold;
}

blockquote {
    border-left: 4px solid var(--quote-bar);
    margin: 1em 0;
    padding: 0.5em 1em;
    color: #555;
    page-break-inside: avoid;
}

a { color: var(--link); text-decoration: underline; }

ul, ol { margin: 0.5em 0; padding-left: 2em; }
li { margin: 0.3em 0; }

hr {
    border: none;
    border-top: 1px solid var(--hr-color);
    margin: 1.5em 0;
}

.code-block-wrapper { position: relative; margin: 1em 0; }

/* Diagram blocks: the white page inside a thin grey frame, mirroring the preview.
   The <pre> a fence sits in loses its code styling for diagram blocks only. */
pre:has(> .code-block-wrapper.diagram-block) {
    background: none;
    border: none;
    padding: 0;
}

.code-block-wrapper.diagram-block {
    background: white;
    border: 1px solid var(--border);
    padding: 12px;
}

/* Archdia and graph draw from the cloned light palette; the print variables win
   here so the diagram sits on the white page with the unified box look. */
.code-block-wrapper .archdia-viewer-artboard .archdia-svg {
    --archdia-bg: var(--bg);
    --archdia-accent-bg: var(--diagram-box-fill);
    --archdia-text: var(--text);
    --archdia-box-border: var(--muted);
    --archdia-muted: var(--muted);
}

.code-block-wrapper .graph-viewer-artboard .graph-svg {
    --graph-bg: var(--bg);
    --graph-accent-bg: var(--diagram-box-fill);
    --graph-text: var(--text);
    --graph-box-border: var(--muted);
    --graph-muted: var(--muted);
}

/* Mermaid: the shared 8px radius on every box and 14px on every line text,
   mirroring the preview (see KIAO_DIAGRAM_GEOMETRY). */
.mermaid svg rect {
    rx: 8px;
    ry: 8px;
}

.mermaid .edgeLabel {
    font-size: 14px;
}

.mermaid svg .messageText,
.mermaid svg .noteText,
.mermaid svg .loopText,
.mermaid svg .labelText {
    font-size: 14px !important;
}

/* Diagram containers */
.archdia-viewer-container { overflow: visible !important; }
.archdia-viewer-artboard { overflow: visible !important; }

/* Syntax highlighter overrides for print */
div[class*="language-"] { font-size: 10pt !important; }
span[style] { color: #1a1a1a !important; }
</style>
<style>${katexStyles}</style>
<style>${buildPdfThemeCss(theme).replace(/<\/style/gi, '<\\/style')}</style>
</head>
<body>
${renderPdfThemeHeader(theme, title)}
${html}
</body>
</html>`);

    printWindow.document.close();

    const images = printWindow.document.querySelectorAll('img');
    const imagePromises = Array.from(images).map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise<void>(resolve => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
        });
    });

    Promise.all(imagePromises).then(() => {
        setTimeout(() => {
            printWindow.print();
        }, 500);
    });
}
