import {
    AlignmentType, Bookmark, BorderStyle, Document, ExternalHyperlink, HeadingLevel, ImageRun,
    InternalHyperlink, LevelFormat, Packer, Paragraph, Table, TableCell, TableRow, TextRun, UnderlineType,
    WidthType, type IParagraphOptions, type IRunOptions, type INumberingOptions,
} from 'docx';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import { remarkKiaoDiagramRestore, remarkKiaoDiagramHideCompanion } from './lib/kiaoDiagramRemark';
import { DIAGRAM_LANGUAGES, type DiagramLanguage } from './static/fences';
import { prepareDiagramSvg } from './static/prepareDiagramSvg';
import { wordImage, WORD_CONTENT_WIDTH } from './docxImages';
import { resolveWordTheme } from './wordThemes';
import type { MarkdownDocxOptions } from './exportMarkdownToDocx';

type Block = Paragraph | Table;
type Inline = TextRun | ImageRun | InternalHyperlink | ExternalHyperlink;
type MarkdownNode = { type: string; lang?: string | null; value?: string; children?: MarkdownNode[] };
type BlockContext = { level?: number; maxWidth?: number; quote?: boolean; bold?: boolean; numbering?: IParagraphOptions['numbering'] };

/** Markdown -> semantic HTML -> native Word blocks. Never altChunk (unsupported by several readers). */
export async function generateMarkdownDocx(source: string, options: MarkdownDocxOptions): Promise<Blob> {
    const { loadResource, onProgress } = options;
    // The theme's palette over the neutral native style; without a theme this
    // is the previous constants, so the default export is unchanged.
    const palette = resolveWordTheme(options.theme);
    const diagrams = new Map<string, Blob>();
    const images = new Map<string, Blob>();
    const numbering: INumberingOptions['config'][number][] = [];
    let imageCount = 0;
    onProgress?.('Reading Markdown…');

    const processor = unified().use(remarkParse).use(remarkGfm)
        .use(remarkKiaoDiagramRestore).use(remarkKiaoDiagramHideCompanion)
        .use(() => async (tree: unknown) => {
            const targets: MarkdownNode[] = [];
            const collect = (node: MarkdownNode) => {
                if (node.type === 'code' && DIAGRAM_LANGUAGES.includes(node.lang?.toLowerCase() as DiagramLanguage)) targets.push(node);
                node.children?.forEach(collect);
            };
            collect(tree as MarkdownNode);
            for (const [index, node] of targets.entries()) {
                const language = node.lang!.toLowerCase() as DiagramLanguage;
                const label = `${language} #${index + 1}`;
                onProgress?.(`Rendering diagram ${index + 1} of ${targets.length} (${language})…`);
                try {
                    const svg = await prepareDiagramSvg(language, node.value ?? '', {
                        theme: 'light', strict: true, resolveResource: loadResource,
                        plantUmlServerUrl: options.plantUmlServerUrl ?? import.meta.env.VITE_PLANTUML_SERVER_URL,
                    });
                    const url = `kiao-docx:diagram-${index + 1}`;
                    diagrams.set(url, new Blob([svg], { type: 'image/svg+xml' }));
                    Object.assign(node, { type: 'paragraph', children: [{ type: 'image', url, alt: label }] });
                } catch (error) {
                    throw new Error(`Diagram ${label} failed: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        })
        .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSlug).use(rehypeStringify);
    const html = String(await processor.process(source));
    const body = new DOMParser().parseFromString(html, 'text/html').body;

    async function image(element: Element, maxWidth: number): Promise<ImageRun> {
        const src = element.getAttribute('src') || '';
        const alt = element.getAttribute('alt') || `Image ${++imageCount}`;
        onProgress?.(`Embedding ${alt}…`);
        try {
            let blob = diagrams.get(src) ?? images.get(src);
            if (!blob) {
                blob = await loadResource(src);
                images.set(src, blob);
            }
            return await wordImage(blob, alt, loadResource, maxWidth);
        } catch (error) {
            throw new Error(`${alt} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async function inline(nodes: Iterable<Node>, style: IRunOptions = {}, maxWidth = WORD_CONTENT_WIDTH): Promise<Inline[]> {
        const runs: Inline[] = [];
        for (const node of nodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                if (node.textContent) runs.push(new TextRun({ ...style, text: node.textContent.replace(/\n/g, ' ') }));
                continue;
            }
            if (!(node instanceof Element)) continue;
            const tag = node.tagName.toLowerCase();
            if (tag === 'img') { runs.push(await image(node, maxWidth)); continue; }
            if (tag === 'br') { runs.push(new TextRun({ ...style, break: 1 })); continue; }
            if (tag === 'input' && node.getAttribute('type') === 'checkbox') {
                runs.push(new TextRun({ ...style, text: node.hasAttribute('checked') ? '☑ ' : '☐ ' }));
                continue;
            }
            if (['script', 'style'].includes(tag)) throw new Error(`Unsupported HTML element: ${tag}`);
            if (['video', 'audio', 'iframe', 'object', 'embed', 'canvas', 'svg'].includes(tag)) {
                throw new Error(`Unsupported HTML element: ${tag}. Use an image or a fenced diagram.`);
            }
            const next = { ...style };
            if (['strong', 'b', 'th'].includes(tag)) next.bold = true;
            if (['em', 'i'].includes(tag)) next.italics = true;
            if (['del', 's'].includes(tag)) next.strike = true;
            if (tag === 'u') next.underline = { type: UnderlineType.SINGLE };
            if (tag === 'sup') next.superScript = true;
            if (tag === 'sub') next.subScript = true;
            if (tag === 'code') { next.font = 'Courier New'; next.size = 20; }
            if (tag === 'a' && node.getAttribute('href')) {
                const href = node.getAttribute('href')!;
                // A themed link wins over its surroundings, as in print where the
                // `a` rule comes after the heading ones.
                const linkStyle = palette.link ? { ...next, color: palette.link, style: 'Hyperlink' } : { ...next, style: 'Hyperlink' };
                const children = await inline(node.childNodes, linkStyle, maxWidth);
                if (href.startsWith('#')) {
                    const raw = href.slice(1);
                    if (!raw) runs.push(...children);
                    else {
                        let anchor = raw;
                        try { anchor = decodeURIComponent(raw); } catch { /* keep raw */ }
                        runs.push(new InternalHyperlink({ anchor, children }));
                    }
                } else runs.push(new ExternalHyperlink({ link: href, children }));
            } else runs.push(...await inline(node.childNodes, next, maxWidth));
        }
        return runs;
    }

    function listNumbering(ordered: boolean, start: number): string {
        const reference = `list-${numbering.length + 1}`;
        numbering.push({ reference, levels: Array.from({ length: 9 }, (_, level) => ({
            level, format: ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
            text: ordered ? `%${level + 1}.` : '•', start,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })) });
        return reference;
    }

    async function blocks(nodes: Iterable<Node>, context: BlockContext = {}): Promise<Block[]> {
        const result: Block[] = [];
        let pending: Node[] = [];
        const maxWidth = context.maxWidth ?? WORD_CONTENT_WIDTH;
        const runStyle: IRunOptions = context.bold ? { bold: true } : {};
        const paragraphOptions: IParagraphOptions = context.quote ? {
            indent: { left: 360 }, border: { left: { color: palette.quoteBar, size: 12, style: BorderStyle.SINGLE, space: 8 } },
        } : {};
        const paragraph = (options: IParagraphOptions) => new Paragraph({
            ...paragraphOptions, ...(result.length === 0 ? { numbering: context.numbering } : {}), ...options,
        });
        const flush = async () => {
            if (pending.some(node => node.nodeType === Node.ELEMENT_NODE || node.textContent?.trim())) {
                result.push(paragraph({ children: await inline(pending, runStyle, maxWidth) }));
            }
            pending = [];
        };
        for (const node of nodes) {
            if (!(node instanceof Element)) { pending.push(node); continue; }
            const tag = node.tagName.toLowerCase();
            if (!/^(p|div|section|article|header|footer|h[1-6]|ul|ol|pre|blockquote|table|hr)$/.test(tag)) {
                pending.push(node); continue;
            }
            await flush();
            if (/^h[1-6]$/.test(tag)) {
                const headingColor = palette.headings[Number(tag[1]) - 1];
                const headingRuns = await inline(node.childNodes,
                    headingColor ? { ...runStyle, color: headingColor } : runStyle, maxWidth);
                const headingId = node.getAttribute('id');
                result.push(paragraph({ heading: HeadingLevel[`HEADING_${tag[1]}` as keyof typeof HeadingLevel],
                    keepNext: true, spacing: { before: 240, after: 120 },
                    children: headingId ? [new Bookmark({ id: headingId, children: headingRuns })] : headingRuns }));
            } else if (tag === 'p') {
                result.push(paragraph({ children: await inline(node.childNodes, runStyle, maxWidth) }));
            } else if (tag === 'pre') {
                // One Word paragraph per line preserves whitespace, empty lines, and editable code.
                for (const line of (node.textContent ?? '').replace(/\n$/, '').split('\n')) {
                    result.push(paragraph({ style: 'Code', children: [new TextRun({ text: line || ' ', font: 'Courier New', size: 18 })] }));
                }
            } else if (tag === 'blockquote') {
                result.push(...await blocks(node.childNodes, { ...context, quote: true, maxWidth: maxWidth - 24 }));
            } else if (tag === 'ul' || tag === 'ol') {
                const level = context.level ?? 0;
                if (level > 8) throw new Error('Word supports at most nine nested list levels');
                const reference = listNumbering(tag === 'ol', Number(node.getAttribute('start') || 1));
                for (const item of Array.from(node.children)) {
                    if (item.tagName !== 'LI') continue;
                    // Group the item's inline intro and loose paragraphs, then its nested blocks.
                    const itemBlocks = await blocks(item.childNodes, { ...context, level: level + 1, numbering: { reference, level } });
                    if (!(itemBlocks[0] instanceof Paragraph)) itemBlocks.unshift(new Paragraph({ numbering: { reference, level } }));
                    result.push(...itemBlocks);
                }
            } else if (tag === 'table') {
                const rows = Array.from(node.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr'));
                const columns = Math.max(1, ...rows.map(row => row.children.length));
                const tableRows: TableRow[] = [];
                for (const row of rows) {
                    const cells: TableCell[] = [];
                    for (const cell of Array.from(row.children)) {
                        const children = await blocks(cell.childNodes, { ...context, numbering: undefined, bold: cell.tagName === 'TH', maxWidth: maxWidth / columns - 16 });
                        if (!(children[children.length - 1] instanceof Paragraph)) children.push(new Paragraph(''));
                        cells.push(new TableCell({ children, columnSpan: Number(cell.getAttribute('colspan') || 1),
                            shading: cell.tagName === 'TH' ? { fill: palette.tableHeader } : undefined }));
                    }
                    tableRows.push(new TableRow({ children: cells, tableHeader: row.parentElement?.tagName === 'THEAD' }));
                }
                result.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows }));
            } else if (tag === 'hr') {
                result.push(new Paragraph({ border: { bottom: { color: palette.rule, size: 6, style: BorderStyle.SINGLE } } }));
            } else result.push(...await blocks(node.childNodes, context));
        }
        await flush();
        return result;
    }

    const children = await blocks(body.childNodes);
    onProgress?.('Creating Word document…');
    const doc = new Document({
        title: options.title,
        styles: {
            default: { document: { run: { font: 'Calibri', size: 22, color: palette.text }, paragraph: { spacing: { after: 120 } } } },
            paragraphStyles: [{ id: 'Code', name: 'Code', basedOn: 'Normal',
                paragraph: { spacing: { after: 0 }, shading: { fill: palette.codeFill } } }],
        },
        numbering: { config: numbering },
        sections: [{ properties: { page: { size: { width: 11906, height: 16838 },
            margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
    });
    return Packer.toBlob(doc);
}
