/** CommonMark fence scan: an opening fence consumes to its own close, so fenced examples stay examples. */

/** Languages the static export replaces with images; matches the renderer. */
export const DIAGRAM_LANGUAGES = ['mermaid', 'plantuml', 'archdia', 'graph', 'svg'] as const;

export type DiagramLanguage = (typeof DIAGRAM_LANGUAGES)[number];

const isDiagramLanguage = (value: string): value is DiagramLanguage =>
    (DIAGRAM_LANGUAGES as readonly string[]).includes(value);

export interface DiagramBlock {
    language: DiagramLanguage;
    /** Body without markers or opening indent. */
    code: string;
    start: number;
    /** Past the closing fence, terminator excluded; splicing preserves surrounding blank lines. */
    end: number;
}

interface Line {
    text: string;
    start: number;
    end: number;
}

interface OpenFence {
    char: '`' | '~';
    length: number;
    indent: number;
    language: string;
}

function scanLines(source: string): Line[] {
    const lines: Line[] = [];
    let start = 0;
    for (let i = 0; i <= source.length; i++) {
        if (i === source.length || source[i] === '\n') {
            let end = i;
            if (end > start && source[end - 1] === '\r') end--;
            lines.push({ text: source.slice(start, end), start, end });
            start = i + 1;
        }
    }
    // Drop the empty final line so offsets stay in range.
    if (lines.length > 1 && lines[lines.length - 1].text === '' && source.endsWith('\n')) lines.pop();
    return lines;
}

function matchOpeningFence(text: string): OpenFence | null {
    const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(text);
    if (!match) return null;

    const [, indent, marker, rest] = match;
    const char = marker[0] as '`' | '~';
    // CommonMark: backtick info strings contain no backtick.
    if (char === '`' && rest.includes('`')) return null;

    return {
        char,
        length: marker.length,
        indent: indent.length,
        language: rest.trim().split(/\s+/)[0]?.toLowerCase() ?? '',
    };
}

function isClosingFence(text: string, open: OpenFence): boolean {
    const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(text);
    if (!match) return false;
    return match[1][0] === open.char && match[1].length >= open.length;
}

function stripIndent(text: string, width: number): string {
    let cut = 0;
    while (cut < width && text[cut] === ' ') cut++;
    return text.slice(cut);
}

/** Opening `kiao:diagram` line that does not self-close. Marker duplicated to avoid a cycle. */
const isKiaoCommentOpen = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed.startsWith('<!--') || !trimmed.includes('kiao:diagram')) return false;
    const markerAt = trimmed.indexOf('kiao:diagram');
    const closeAt = trimmed.indexOf('-->');
    return closeAt === -1 || closeAt < markerAt;
};

const isImageLine = (text: string): boolean =>
    /^\s*!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)\s*$/.test(text);

/** Last line of the wrapped block at `openLine`, or `null`. The fence is matched before the close so `A-->B` in source is not the comment end. */
const skipWrappedBlock = (lines: Line[], openLine: number): number | null => {
    for (let i = openLine + 1; i < lines.length; i++) {
        if (lines[i].text.includes('-->')) return null;
        const open = matchOpeningFence(lines[i].text);
        if (!open) continue;
        let close = i + 1;
        while (close < lines.length && !isClosingFence(lines[close].text, open)) close++;
        if (close >= lines.length) return null;
        let closeLine = close + 1;
        while (closeLine < lines.length && !lines[closeLine].text.includes('-->')) closeLine++;
        if (closeLine >= lines.length) return null;
        let endLine = closeLine;
        let next = closeLine + 1;
        while (next < lines.length && lines[next].text.trim() === '') next++;
        if (next < lines.length && isImageLine(lines[next].text)) endLine = next;
        return endLine;
    }
    return null;
};

/** All diagram blocks in order. Unclosed fences run to EOF; `kiao:diagram` comments are skipped whole. */
export function findDiagramBlocks(markdown: string): DiagramBlock[] {
    const lines = scanLines(markdown);
    const blocks: DiagramBlock[] = [];

    let i = 0;
    while (i < lines.length) {
        if (isKiaoCommentOpen(lines[i].text)) {
            const endLine = skipWrappedBlock(lines, i);
            if (endLine !== null) {
                i = endLine + 1;
                continue;
            }
            i++;
            continue;
        }

        const open = matchOpeningFence(lines[i].text);
        if (!open) {
            i++;
            continue;
        }

        let close = i + 1;
        while (close < lines.length && !isClosingFence(lines[close].text, open)) close++;

        if (isDiagramLanguage(open.language)) {
            const body = lines.slice(i + 1, Math.min(close, lines.length));
            blocks.push({
                language: open.language,
                code: body.map(line => stripIndent(line.text, open.indent)).join('\n'),
                start: lines[i].start,
                end: lines[Math.min(close, lines.length - 1)].end,
            });
        }

        i = close + 1;
    }

    return blocks;
}

/** Splices replacements in place; `null` leaves the block untouched. */
export function replaceBlocks(
    markdown: string,
    blocks: DiagramBlock[],
    replacements: (string | null)[],
): string {
    let out = '';
    let cursor = 0;
    blocks.forEach((block, index) => {
        const replacement = replacements[index];
        if (replacement === null || replacement === undefined) return;
        out += markdown.slice(cursor, block.start) + replacement;
        cursor = block.end;
    });
    return out + markdown.slice(cursor);
}
