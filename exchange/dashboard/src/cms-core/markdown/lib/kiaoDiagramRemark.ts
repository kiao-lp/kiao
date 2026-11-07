/** `kiao:diagram` stores diagram source in an HTML comment with a rendered image. Kiao restores the source and hides the image. */

import { DIAGRAM_LANGUAGES } from '../static/fences';

export const KIAO_DIAGRAM_MARKER = 'kiao:diagram';

/** Escapes diagram code for HTML comments. `&` must be escaped first. */
export const escapeKiaoDiagramCode = (code: string): string =>
    code.replace(/&/g, '&amp;').replace(/-->/g, '--&gt;');

export const unescapeKiaoDiagramCode = (code: string): string =>
    code.replace(/--&gt;/g, '-->').replace(/&amp;/g, '&');

const isDiagramLanguage = (value: string): boolean =>
    (DIAGRAM_LANGUAGES as readonly string[]).includes(value);

interface ParsedFence {
    language: string;
    code: string;
    /** Opening-fence offset in the HTML value. */
    startInHtml: number;
    /** Offset past the closing fence. */
    endInHtml: number;
}

interface HtmlLine {
    text: string;
    start: number;
    end: number;
}

const scanLines = (source: string): HtmlLine[] => {
    const lines: HtmlLine[] = [];
    let start = 0;
    for (let i = 0; i <= source.length; i++) {
        if (i === source.length || source[i] === '\n') {
            let end = i;
            if (end > start && source[end - 1] === '\r') end--;
            lines.push({ text: source.slice(start, end), start, end });
            start = i + 1;
        }
    }
    return lines;
};

const matchOpening = (text: string): { char: string; length: number; indent: number; language: string } | null => {
    const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(text);
    if (!match) return null;
    const [, indent, marker, rest] = match;
    if (marker[0] === '`' && rest.includes('`')) return null;
    return {
        char: marker[0],
        length: marker.length,
        indent: indent.length,
        language: rest.trim().split(/\s+/)[0]?.toLowerCase() ?? '',
    };
};

const isClosing = (text: string, char: string, length: number): boolean => {
    const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(text);
    if (!match) return false;
    return match[1][0] === char && match[1].length >= length;
};

const stripIndent = (text: string, width: number): string => {
    let cut = 0;
    while (cut < width && text[cut] === ' ') cut++;
    return text.slice(cut);
};

/** First fence inside a `kiao:diagram` comment, or `null`. */
export const parseKiaoDiagramHtml = (html: string): ParsedFence | null => {
    if (!html.trimStart().startsWith('<!--') || !html.includes(KIAO_DIAGRAM_MARKER)) return null;
    if (!html.includes('-->')) return null;

    const lines = scanLines(html);
    let first = 0;
    while (first < lines.length && !lines[first].text.includes(KIAO_DIAGRAM_MARKER)) first++;
    let last = lines.length - 1;
    while (last >= 0 && !lines[last].text.includes('-->')) last--;
    if (first >= last) return null;

    for (let i = first + 1; i < last; i++) {
        const open = matchOpening(lines[i].text);
        if (!open) continue;
        let close = i + 1;
        while (close < last && !isClosing(lines[close].text, open.char, open.length)) close++;
        if (close >= last) return null;
        const body = lines.slice(i + 1, close);
        return {
            language: open.language,
            code: unescapeKiaoDiagramCode(body.map(line => stripIndent(line.text, open.indent)).join('\n')),
            startInHtml: lines[i].start,
            endInHtml: lines[close].end,
        };
    }
    return null;
};

const isCompanionParagraph = (node: any): boolean =>
    node?.type === 'paragraph'
    && node.children?.length === 1
    && node.children[0]?.type === 'image';

/** Restores carried fences as `code` nodes. Node position covers only the inner fence. */
export const remarkKiaoDiagramRestore = () => (tree: any): void => {
    const visit = (node: any): void => {
        if (!node?.children) return;
        for (let i = 0; i < node.children.length; i++) {
            const child = node.children[i];
            if (child?.type === 'html') {
                const parsed = parseKiaoDiagramHtml(child.value ?? '');
                if (parsed && isDiagramLanguage(parsed.language)) {
                    const htmlStart = child.position?.start;
                    let position = child.position;
                    if (htmlStart && typeof htmlStart.offset === 'number') {
                        const before = (child.value as string).slice(0, parsed.startInHtml);
                        const inner = (child.value as string).slice(parsed.startInHtml, parsed.endInHtml);
                        const startLine = htmlStart.line + (before.match(/\n/g) ?? []).length;
                        const endLine = startLine + (inner.match(/\n/g) ?? []).length;
                        position = {
                            start: { line: startLine, column: 1, offset: htmlStart.offset + parsed.startInHtml },
                            end: { line: endLine, column: 1, offset: htmlStart.offset + parsed.endInHtml },
                        };
                    }
                    node.children[i] = {
                        type: 'code',
                        lang: parsed.language,
                        value: parsed.code,
                        data: { kiaoDiagram: true },
                        position,
                    };
                    continue;
                }
            }
            visit(child);
        }
    };
    visit(tree);
};

/** Drops the companion image only after a restored diagram. */
export const remarkKiaoDiagramHideCompanion = () => (tree: any): void => {
    const visit = (node: any): void => {
        if (!node?.children) return;
        const kept: any[] = [];
        for (let i = 0; i < node.children.length; i++) {
            const child = node.children[i];
            visit(child);
            kept.push(child);
            const restored = child?.type === 'code' && child?.data?.kiaoDiagram === true;
            if (restored && isCompanionParagraph(node.children[i + 1])) i++;
        }
        node.children = kept;
    };
    visit(tree);
};
