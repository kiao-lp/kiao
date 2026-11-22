import { fenceRanges, isInsideFence } from '@kiao-dashboard-kit/markdown';

/** A heading of the document, in file order. */
export interface MarkdownHeading {
    /** 1 for `#`, 6 for `######`. */
    level: number;
    /** Heading text with the inline markup removed. */
    text: string;
    /** 1-based source line, the line the preview stamps on the rendered heading. */
    line: number;
}

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?$/;
const CLOSING_HASHES = /[ \t]+#+$/;

/** Links and images by their text, code and emphasis unwrapped. */
const headingText = (raw: string): string => raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_~]{1,3}/g, '')
    .trim();

/** Lines the leading YAML front matter occupies; 0 when there is none. */
const frontMatterLines = (lines: string[]): number => {
    if (lines[0]?.trimEnd() !== '---') return 0;
    const end = lines.findIndex((line, index) => index > 0 && ['---', '...'].includes(line.trimEnd()));
    return end === -1 ? 0 : end + 1;
};

/** The headings a table of contents lists: ATX headings outside fences and front matter. */
export const markdownHeadings = (text: string): MarkdownHeading[] => {
    const lines = text.split('\n');
    const fences = fenceRanges(text);
    const frontMatter = frontMatterLines(lines);
    const headings: MarkdownHeading[] = [];

    let offset = 0;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const start = offset;
        offset += line.length + 1;

        if (index < frontMatter || isInsideFence(start, fences)) continue;
        const match = ATX_HEADING.exec(line.trimEnd());
        if (!match) continue;

        const text = headingText((match[2] ?? '').replace(CLOSING_HASHES, ''));
        headings.push({ level: match[1].length, text: text || 'Untitled', line: index + 1 });
    }
    return headings;
};
