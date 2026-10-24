/**
 * An SVG file as the editor holds it, and the two arrows between the two.
 *
 * The drawing is the `<svg>` element's top-level children in order: the shapes the canvas
 * edits (`model.ts`), and every other node — `defs`, `style`, `metadata`, comments,
 * whitespace — carried through verbatim so a save only moves what the edit touched. The
 * root's own attributes travel the same way, `width`/`height` aside, which are the canvas
 * size and are edited as such. Unknown elements are `raw`, never shapes: the canvas draws
 * them as-is and offers no handle on them.
 */

import { DEFAULT_CANVAS, emptyDrawing, isShapeTag, numAttr, SvgDrawing, SvgNode, SvgShape, fmt } from './model';

export interface SvgDocument {
    /** Anything before the `<svg>` — the XML declaration, doctype — or '' where there was none. */
    prolog: string;
    /** The root's attributes other than `width`/`height` (`xmlns`, `viewBox`, …), verbatim. */
    rootAttrs: Record<string, string>;
    drawing: SvgDrawing;
}

const mintId = (): string =>
    'SHAPE-' + Array.from(crypto.getRandomValues(new Uint8Array(4)))
        .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

const attrsOf = (element: Element): Record<string, string> => {
    const attrs: Record<string, string> = {};
    for (const attr of Array.from(element.attributes)) attrs[attr.name] = attr.value;
    return attrs;
};

const serializeNode = (node: Node): string => new XMLSerializer().serializeToString(node);

/**
 * Whether the three letters of the file already name one — `fill`, say, against `FILL`:
 * attribute names are matched case-insensitively on the way in, since hand-written files
 * vary, and written out in the case the editor uses.
 */
const KNOWN_ATTR_CASE: Record<string, string> = {
    viewbox: 'viewBox',
    fontsize: 'font-size',
    fontfamily: 'font-family',
    fontweight: 'font-weight',
    strokewidth: 'stroke-width',
    strokedasharray: 'stroke-dasharray',
    textanchor: 'text-anchor',
};

const canonicalAttrName = (name: string): string =>
    KNOWN_ATTR_CASE[name.toLowerCase()] ?? name;

/**
 * Text → document. Throws on a text that holds no `<svg>` at all — not XML, or XML of
 * another kind — which is the file the canvas leaves alone (the source view still edits it).
 */
export const decodeSvg = (source: string): SvgDocument => {
    const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
    if (parsed.querySelector('parsererror')) throw new Error('Not an SVG document');
    const root = parsed.documentElement;
    if (!root || root.tagName.toLowerCase() !== 'svg') throw new Error('Not an SVG document');

    const prologMatch = /^([\s\S]*?)<svg[\s>]/.exec(source);
    const prolog = prologMatch ? prologMatch[1].trim() : '';

    const rawRoot = attrsOf(root);
    const width = numAttr(rawRoot, 'width', NaN);
    const height = numAttr(rawRoot, 'height', NaN);
    const viewBox = (rawRoot.viewBox ?? rawRoot.viewbox ?? '').trim().split(/[\s,]+/).map(Number);
    const rootAttrs: Record<string, string> = {};
    for (const [name, value] of Object.entries(rawRoot)) {
        if (name.toLowerCase() === 'width' || name.toLowerCase() === 'height') continue;
        rootAttrs[canonicalAttrName(name)] = value;
    }
    const canvas = {
        width: Number.isFinite(width) && width > 0 ? width
            : viewBox.length === 4 && Number.isFinite(viewBox[2]) && viewBox[2] > 0 ? viewBox[2]
                : DEFAULT_CANVAS.width,
        height: Number.isFinite(height) && height > 0 ? height
            : viewBox.length === 4 && Number.isFinite(viewBox[3]) && viewBox[3] > 0 ? viewBox[3]
                : DEFAULT_CANVAS.height,
    };

    const taken = new Set<string>();
    const claimId = (wanted: string | null): string => {
        let id = (wanted ?? '').trim() || mintId();
        while (taken.has(id)) id = `${id}-2`;
        taken.add(id);
        return id;
    };

    const nodes: SvgNode[] = [];
    for (const child of Array.from(root.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) {
            const element = child as Element;
            const tag = element.tagName.toLowerCase();
            if (isShapeTag(tag)) {
                const { id, ...rest } = attrsOf(element);
                const attrs: Record<string, string> = {};
                for (const [name, value] of Object.entries(rest)) attrs[canonicalAttrName(name)] = value;
                const shape: SvgShape = { id: claimId(id ?? null), tag, attrs };
                if (tag === 'text') shape.text = element.textContent ?? '';
                if (tag === 'g') shape.inner = Array.from(element.childNodes).map(serializeNode).join('');
                nodes.push({ kind: 'shape', shape });
                continue;
            }
        }
        // Anything else — defs, style, metadata, comments, whitespace — verbatim.
        const xml = serializeNode(child);
        if (child.nodeType === Node.TEXT_NODE && xml.trim() === '') continue;
        nodes.push({ kind: 'raw', xml });
    }

    return { prolog, rootAttrs, drawing: { canvas, nodes } };
};

const escapeAttr = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const escapeText = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const shapeXml = (shape: SvgShape): string => {
    const attrs = [`id="${escapeAttr(shape.id)}"`,
        ...Object.entries(shape.attrs).map(([name, value]) => `${name}="${escapeAttr(value)}"`)].join(' ');
    if (shape.tag === 'text') return `<text ${attrs}>${escapeText(shape.text ?? '')}</text>`;
    if (shape.tag === 'g') return `<g ${attrs}>${shape.inner ?? ''}</g>`;
    return `<${shape.tag} ${attrs}/>`;
};

/**
 * Document → the exact text a save writes. Stable: writing the same document twice writes
 * the same text twice, which is what lets a save for an unchanged drawing write nothing.
 */
export const encodeSvg = (document: SvgDocument): string => {
    const { prolog, rootAttrs, drawing } = document;
    const root = [`width="${fmt(drawing.canvas.width)}"`, `height="${fmt(drawing.canvas.height)}"`,
        ...Object.entries(rootAttrs).map(([name, value]) => `${name}="${escapeAttr(value)}"`)].join(' ');
    const body = drawing.nodes
        .map(node => node.kind === 'shape' ? shapeXml(node.shape) : node.xml)
        .map(xml => `  ${xml}`)
        .join('\n');
    const svg = `<svg ${root}>\n${body}\n</svg>\n`;
    return prolog ? `${prolog}\n${svg}` : svg;
};

/** A document for a drawing without one — what "New SVG image" writes, and a paste lands in. */
export const documentOfDrawing = (drawing: SvgDrawing): SvgDocument => ({
    prolog: '<?xml version="1.0" encoding="UTF-8"?>',
    rootAttrs: { xmlns: 'http://www.w3.org/2000/svg' },
    drawing,
});

export const emptySvgDocument = (): SvgDocument => documentOfDrawing(emptyDrawing());

/**
 * The shapes a pasted clipboard text holds — a whole `<svg>`, or bare shape elements — under
 * fresh ids, offset so a paste onto its own drawing lands visibly beside the original. `null`
 * for text that holds no shape, which is the normal case for a clipboard shared with every
 * other program rather than an error to report.
 */
export const pastedShapes = (text: string, taken: Set<string>): SvgShape[] | null => {
    const wrapped = /<svg[\s>]/.test(text) ? text : `<svg>${text}</svg>`;
    let document: SvgDocument;
    try {
        document = decodeSvg(wrapped);
    } catch {
        return null;
    }
    const shapes = document.drawing.nodes
        .filter((node): node is { kind: 'shape'; shape: SvgShape } => node.kind === 'shape')
        .map(node => node.shape);
    if (shapes.length === 0) return null;
    const fresh = new Set(taken);
    return shapes.map(shape => {
        let id = shape.id;
        while (fresh.has(id)) id = `${id}-2`;
        fresh.add(id);
        return { ...shape, id };
    });
};
