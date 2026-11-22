import { describe, it, expect } from 'vitest';
import { markdownHeadings } from './tableOfContents';

const lines = (text: string) => markdownHeadings(text).map(({ level, text: heading, line }) => ({ level, heading, line }));

describe('the headings a table of contents lists', () => {
    it('reads every ATX heading with its level and source line', () => {
        expect(lines('# Title\n\nintro\n\n## Part\n\n### Detail\n')).toEqual([
            { level: 1, heading: 'Title', line: 1 },
            { level: 2, heading: 'Part', line: 5 },
            { level: 3, heading: 'Detail', line: 7 },
        ]);
    });

    it('keeps `#` lines inside a fence out of the list', () => {
        expect(lines('## Real\n\n```md\n# commented out\n```\n\n~~~\n### also code\n~~~\n\n### After\n')).toEqual([
            { level: 2, heading: 'Real', line: 1 },
            { level: 3, heading: 'After', line: 11 },
        ]);
    });

    it('skips YAML front matter, comment lines included', () => {
        expect(lines('---\ndocument:\n  # not a heading\n---\n\n## After\n')).toEqual([
            { level: 2, heading: 'After', line: 6 },
        ]);
    });

    it('shows heading text without its markup', () => {
        expect(lines('# A **bold** [link](path.md) `code`\n## Closed ##\n')).toEqual([
            { level: 1, heading: 'A bold link code', line: 1 },
            { level: 2, heading: 'Closed', line: 2 },
        ]);
    });

    it('ignores hashes that are not a heading', () => {
        expect(lines('#no space\n    # indented code\n')).toEqual([]);
        expect(lines('###\n')).toEqual([{ level: 3, heading: 'Untitled', line: 1 }]);
    });

    it('reads CRLF documents by line', () => {
        expect(lines('## One\r\n\r\ntext\r\n### Two\r\n')).toEqual([
            { level: 2, heading: 'One', line: 1 },
            { level: 3, heading: 'Two', line: 4 },
        ]);
    });
});
