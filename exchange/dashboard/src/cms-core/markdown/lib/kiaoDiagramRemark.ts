/**
 * The `kiao:diagram` convention: one file, one render on each side.
 *
 * A diagram that GitHub can show and kiao can still edit lives as two blocks:
 * its fenced source inside an HTML comment, followed by its pre-rendered SVG:
 *
 *   <!-- kiao:diagram
 *   ```mermaid
 *   graph TD;
 *   ```
 *   -->
 *   ![Mermaid diagram 1](Doc.assets/01-mermaid.svg)
 *
 * GitHub hides the comment and shows the image. Kiao does the inverse with the
 * two plugins below: the first extracts the fence from the comment and reinjects
 * it as a `code` node — recovering the native render and its buttons — and the
 * second drops the companion image that follows it, which kiao never shows when
 * it knows how to draw the source itself.
 *
 * A diagram source routinely holds `-->`, which would close the comment early —
 * every `A-->B` of mermaid, every `A --> B` of PlantUML. The carried fence is
 * therefore escaped on the way in (`&` then `-->`) and unescaped on the way out,
 * so no line between the markers ever holds the closing sequence.
 */

import { DIAGRAM_LANGUAGES } from '../static/fences';

/** The marker opening the HTML comment that carries a diagram's source. */
export const KIAO_DIAGRAM_MARKER = 'kiao:diagram';

/**
 * Escapes a diagram source for its stay inside an HTML comment. `&` first, so an
 * `&gt;` the source already held survives the round trip instead of becoming `>`.
 */
export const escapeKiaoDiagramCode = (code: string): string =>
    code.replace(/&/g, '&amp;').replace(/-->/g, '--&gt;');

/** The inverse: the carried fence back to the source it was written as. */
export const unescapeKiaoDiagramCode = (code: string): string =>
    code.replace(/--&gt;/g, '-->').replace(/&amp;/g, '&');

const isDiagramLanguage = (value: string): boolean =>
    (DIAGRAM_LANGUAGES as readonly string[]).includes(value);

interface ParsedFence {
    language: string;
    code: string;
    /** Offset of the opening fence within the HTML value. */
    startInHtml: number;
    /** Offset just past the closing fence within the HTML value. */
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

/**
 * The fenced block carried inside a `kiao:diagram` comment, or null when the
 * HTML is not one. Only the first fence between the markers is read; anything
 * else in the comment is ignored.
 */
export const parseKiaoDiagramHtml = (html: string): ParsedFence | null => {
    if (!html.trimStart().startsWith('<!--') || !html.includes(KIAO_DIAGRAM_MARKER)) return null;
    if (!html.includes('-->')) return null;

    const lines = scanLines(html);
    // The fence lives between the opening marker line and the closing one.
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
        // An unclosed fence is not a diagram carried for kiao: leave the comment alone.
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

/** Whether this parent's child at `index` is a companion image standing alone. */
const isCompanionParagraph = (node: any): boolean =>
    node?.type === 'paragraph'
    && node.children?.length === 1
    && node.children[0]?.type === 'image';

/**
 * Extracts the fenced source from each `kiao:diagram` comment and reinjects it
 * as a `code` node, tagged so the companion-hiding pass knows what it restored.
 *
 * The re-injected node's position points at the inner fence's own offsets in
 * the source — not at the comment around it — so the edit buttons that report
 * a block's range keep replacing the fence alone, leaving the comment wrapper
 * and the companion image for the next render to refresh.
 */
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

/**
 * Drops the companion image standing right after a restored diagram — and only
 * after one. A picture after a plain fence is the author's own content and is
 * kept; a picture after a comment kiao could not restore (an unknown language)
 * is the only render available and is kept too.
 */
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
