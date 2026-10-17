/**
 * Locating the fenced blocks a static export turns into pictures.
 *
 * The scanner is deliberately CommonMark's, not a regular expression over the whole document:
 * a page that documents this very feature contains a four-backtick fence wrapping a three-backtick
 * `mermaid` one, and a scanner that matched fences independently would replace the inner example
 * with an image — silently destroying the thing being explained. Walking the document once, and
 * letting an opening fence consume everything up to its own closing fence, is what makes an
 * example an example.
 */

/**
 * The languages a static export replaces with an image.
 *
 * The same list the renderer treats as diagrams: a block that draws a picture in the preview must
 * become a picture in the static file, and a block that does not is source code the reader still
 * wants to read as source code.
 */
export const DIAGRAM_LANGUAGES = ['mermaid', 'plantuml', 'archdia', 'graph', 'svg'] as const;

export type DiagramLanguage = (typeof DIAGRAM_LANGUAGES)[number];

const isDiagramLanguage = (value: string): value is DiagramLanguage =>
    (DIAGRAM_LANGUAGES as readonly string[]).includes(value);

/** One diagram found in a markdown source, with the offsets that let it be spliced out. */
export interface DiagramBlock {
    language: DiagramLanguage;
    /** The block's body, fence markers excluded and the opening fence's indent removed. */
    code: string;
    /** Offset of the opening fence's first character. */
    start: number;
    /**
     * Offset just past the closing fence's last character, its line terminator excluded — so
     * splicing a replacement in keeps the blank lines around the block exactly as they were.
     */
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

/** Splits into lines while keeping each one's offsets, which is the whole point of not using `split`. */
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
    // A source ending in a newline yields a final empty line that carries no content; dropping it
    // keeps `end` offsets from ever pointing past the last real character.
    if (lines.length > 1 && lines[lines.length - 1].text === '' && source.endsWith('\n')) lines.pop();
    return lines;
}

function matchOpeningFence(text: string): OpenFence | null {
    const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(text);
    if (!match) return null;

    const [, indent, marker, rest] = match;
    const char = marker[0] as '`' | '~';
    // CommonMark: a backtick fence's info string may not contain a backtick, which is what keeps
    // an inline `` `code` `` span on a line of prose from opening a code block.
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

/** Removes up to `width` leading spaces, the indent CommonMark strips from a fenced block's body. */
function stripIndent(text: string, width: number): string {
    let cut = 0;
    while (cut < width && text[cut] === ' ') cut++;
    return text.slice(cut);
}

/** An opening `kiao:diagram` comment line that does not close on itself. Duplicated from the */
/* convention's own module, which imports this one — the marker string is the contract. */
const isKiaoCommentOpen = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed.startsWith('<!--') || !trimmed.includes('kiao:diagram')) return false;
    const markerAt = trimmed.indexOf('kiao:diagram');
    const closeAt = trimmed.indexOf('-->');
    return closeAt === -1 || closeAt < markerAt;
};

/** A markdown image standing alone on its line. */
const isImageLine = (text: string): boolean =>
    /^\s*!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)\s*$/.test(text);

/**
 * The last line of the wrapped block opened at `openLine` — its `-->` or its companion picture —
 * or null when no well-formed wrapped block opens there. The fence is found first and the close
 * after it, so a hand-typed `A-->B` inside the carried source does not pass for the comment's end.
 */
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

/**
 * Every diagram block in `markdown`, in document order.
 *
 * A fence that is never closed runs to the end of the document, as CommonMark says and as the
 * preview already shows it — the static export renders what the reader sees rather than second-
 * guessing an unfinished document.
 *
 * A `kiao:diagram` comment is stepped over whole: its inner fence is carried for another renderer,
 * not a plain diagram to replace — replacing it would break the wrapped block apart.
 */
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

        // Past the closing fence, never back inside the block: this is what makes a fenced
        // example of a diagram stay an example.
        i = close + 1;
    }

    return blocks;
}

/**
 * Splices `replacements[n]` in place of `blocks[n]`, leaving everything else byte for byte.
 *
 * A replacement of `null` leaves its block untouched, which is how a diagram that failed to
 * render keeps its source in the generated file instead of leaving a hole.
 */
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
