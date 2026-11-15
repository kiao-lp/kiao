/** Line-based scan keeps fenced examples intact. */

import { DIAGRAM_LANGUAGES, type DiagramLanguage } from './fences';
import {
    KIAO_DIAGRAM_MARKER,
    escapeKiaoDiagramCode,
    unescapeKiaoDiagramCode,
} from '../lib/kiaoDiagramRemark';

export { escapeKiaoDiagramCode, unescapeKiaoDiagramCode };

const isDiagramLanguage = (value: string): value is DiagramLanguage =>
    (DIAGRAM_LANGUAGES as readonly string[]).includes(value);

export interface KiaoDiagramTarget {
    language: DiagramLanguage;
    code: string;
    // Offset of `<!--` or fence.
    start: number;
    // Offset past block end, terminator excluded.
    end: number;
    wrapped: boolean;
}

interface Line {
    text: string;
    start: number;
    end: number;
}

const scanLines = (source: string): Line[] => {
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
    if (lines.length > 1 && lines[lines.length - 1].text === '' && source.endsWith('\n')) lines.pop();
    return lines;
};

interface OpenFence {
    char: '`' | '~';
    length: number;
    indent: number;
    language: string;
}

const matchOpeningFence = (text: string): OpenFence | null => {
    const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(text);
    if (!match) return null;
    const [, indent, marker, rest] = match;
    const char = marker[0] as '`' | '~';
    if (char === '`' && rest.includes('`')) return null;
    return {
        char,
        length: marker.length,
        indent: indent.length,
        language: rest.trim().split(/\s+/)[0]?.toLowerCase() ?? '',
    };
};

const isClosingFence = (text: string, open: OpenFence): boolean => {
    const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(text);
    if (!match) return false;
    return match[1][0] === open.char && match[1].length >= open.length;
};

const stripIndent = (text: string, width: number): string => {
    let cut = 0;
    while (cut < width && text[cut] === ' ') cut++;
    return text.slice(cut);
};

const isDiagramCommentOpen = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed.startsWith('<!--') || !trimmed.includes(KIAO_DIAGRAM_MARKER)) return false;
    const markerAt = trimmed.indexOf(KIAO_DIAGRAM_MARKER);
    const closeAt = trimmed.indexOf('-->');
    return closeAt === -1 || closeAt < markerAt;
};

const matchCompanionImage = (text: string): string | null => {
    const match = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/.exec(text);
    return match ? match[2] : null;
};

interface WrappedParse {
    language: DiagramLanguage;
    code: string;
    /** `-->` line, or companion-image line when present. */
    endLine: number;
}

// Match fence before `-->` so `A-->B` in source is not the comment close.
const parseWrapped = (lines: Line[], openLine: number): WrappedParse | null => {
    for (let i = openLine + 1; i < lines.length; i++) {
        if (lines[i].text.includes('-->')) return null;
        const open = matchOpeningFence(lines[i].text);
        if (!open) continue;
        let close = i + 1;
        while (close < lines.length && !isClosingFence(lines[close].text, open)) close++;
        if (close >= lines.length) return null;
        if (!isDiagramLanguage(open.language)) return null;

        let closeLine = close + 1;
        while (closeLine < lines.length && !lines[closeLine].text.includes('-->')) closeLine++;
        if (closeLine >= lines.length) return null;

        const body = lines.slice(i + 1, close);

        let endLine = closeLine;
        let next = closeLine + 1;
        while (next < lines.length && lines[next].text.trim() === '') next++;
        if (next < lines.length && matchCompanionImage(lines[next].text) !== null) endLine = next;

        return {
            language: open.language,
            code: unescapeKiaoDiagramCode(body.map(line => stripIndent(line.text, open.indent)).join('\n')),
            endLine,
        };
    }
    return null;
};

/** Ranges inside a `kiao:diagram` comment need escaping. */
export const isKiaoDiagramRange = (source: string, offset: number): boolean => {
    const before = source.slice(0, offset);
    const markerAt = before.lastIndexOf(KIAO_DIAGRAM_MARKER);
    if (markerAt === -1) return false;
    const commentOpen = before.lastIndexOf('<!--', markerAt);
    if (commentOpen === -1) return false;
    if (before.indexOf('-->', commentOpen) !== -1) return false;
    return source.slice(offset).includes('-->');
};

/** Quoted blocks stay examples. */
export function findKiaoDiagramTargets(markdown: string): KiaoDiagramTarget[] {
    const lines = scanLines(markdown);
    const targets: KiaoDiagramTarget[] = [];

    let i = 0;
    while (i < lines.length) {
        if (isDiagramCommentOpen(lines[i].text)) {
            const parsed = parseWrapped(lines, i);
            if (parsed) {
                targets.push({
                    language: parsed.language,
                    code: parsed.code,
                    start: lines[i].start,
                    end: lines[parsed.endLine].end,
                    wrapped: true,
                });
                i = parsed.endLine + 1;
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
            targets.push({
                language: open.language,
                code: body.map(line => stripIndent(line.text, open.indent)).join('\n'),
                start: lines[i].start,
                end: lines[Math.min(close, lines.length - 1)].end,
                wrapped: false,
            });
        }
        i = close + 1;
    }
    return targets;
}

export const KIAO_DIAGRAM_LABELS: Record<DiagramLanguage, string> = {
    mermaid: 'Mermaid diagram',
    plantuml: 'PlantUML diagram',
    archdia: 'ArchDia diagram',
    graph: 'Graph diagram',
    svg: 'SVG image',
};

const longestRun = (text: string, char: string): number => {
    let longest = 0;
    let current = 0;
    for (const c of text) {
        current = c === char ? current + 1 : 0;
        if (current > longest) longest = current;
    }
    return longest;
};

const escapeAlt = (text: string): string => text.replace(/([[\]])/g, '\\$1');

/** Fence outgrows any backtick run in the body. */
export function formatKiaoDiagramBlock(
    language: DiagramLanguage,
    code: string,
    assetHref: string,
    position: number,
): string {
    const fence = '`'.repeat(Math.max(3, longestRun(code, '`') + 1));
    const body = escapeKiaoDiagramCode(code.replace(/(\r?\n)+$/, ''));
    return [
        `<!-- ${KIAO_DIAGRAM_MARKER}`,
        `${fence}${language}`,
        body,
        fence,
        '-->',
        `![${escapeAlt(`${KIAO_DIAGRAM_LABELS[language]} ${position}`)}](${assetHref})`,
    ].join('\n');
}

/** `null` leaves the target untouched. */
export function replaceKiaoTargets(
    markdown: string,
    targets: KiaoDiagramTarget[],
    replacements: (string | null)[],
): string {
    let out = '';
    let cursor = 0;
    targets.forEach((target, index) => {
        const replacement = replacements[index];
        if (replacement === null || replacement === undefined) return;
        out += markdown.slice(cursor, target.start) + replacement;
        cursor = target.end;
    });
    return out + markdown.slice(cursor);
}
