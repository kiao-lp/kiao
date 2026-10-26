import { describe, it, expect } from 'vitest';
import {
    findTableEdits,
    formatMarkdownTables,
    parseTableAt,
    buildEmptyTable,
    insertRowBelow,
    insertColumnRight,
    columnIndexAt,
    cellContentStart,
} from './markdownTableFormat';

describe('formatMarkdownTables', () => {
    it('aligns a ragged table with loose pipes', () => {
        const input = [
            '| Name | Age |',
            '|-|-|',
            '| Alice | 30 |',
            '| Bob | 7 |',
        ].join('\n');
        expect(formatMarkdownTables(input)).toBe(
            [
                '| Name  | Age |',
                '| ----- | --- |',
                '| Alice | 30  |',
                '| Bob   | 7   |',
            ].join('\n'),
        );
    });

    it('applies column alignment markers', () => {
        const input = [
            '| L | C | R |',
            '| :-- | :-: | --: |',
            '| a | b | c |',
            '| longleft | longcenter | longright |',
        ].join('\n');
        // Header cells follow the column alignment too (Prettier / VS Code
        // behaviour): centred header is centred, right header is right.
        expect(formatMarkdownTables(input)).toBe(
            [
                '| L        |     C      |         R |',
                '| :------- | :--------: | --------: |',
                '| a        |     b      |         c |',
                '| longleft | longcenter | longright |',
            ].join('\n'),
        );
    });

    it('is idempotent on an already-formatted table', () => {
        const formatted = [
            '| Name  | Age |',
            '| ----- | --- |',
            '| Alice | 30  |',
        ].join('\n');
        expect(formatMarkdownTables(formatted)).toBe(formatted);
        // No-op tables still surface an edit; the editor command compares
        // text and skips unchanged ones.
        const edits = findTableEdits(formatted);
        expect(edits).toHaveLength(1);
        expect(edits[0].text).toBe(formatted);
    });

    it('keeps escaped pipes inside a cell', () => {
        const input = ['| a | b |', '| - | - |', '| x \\| y | z |'].join('\n');
        expect(formatMarkdownTables(input)).toBe(
            ['| a      | b   |', '| ------ | --- |', '| x \\| y | z   |'].join('\n'),
        );
    });

    it('leaves a setext heading untouched (no pipes)', () => {
        const input = ['Title', '-----', '', 'body text'].join('\n');
        expect(findTableEdits(input)).toHaveLength(0);
        expect(formatMarkdownTables(input)).toBe(input);
    });

    it('formats a table without outer pipes', () => {
        const input = ['a | bb', '--- | ---', 'ccc | d'].join('\n');
        expect(formatMarkdownTables(input)).toBe(
            ['| a   | bb  |', '| --- | --- |', '| ccc | d   |'].join('\n'),
        );
    });

    it('pads body rows that have fewer cells than the header', () => {
        const input = ['| a | b | c |', '| - | - | - |', '| 1 |'].join('\n');
        expect(formatMarkdownTables(input)).toBe(
            ['| a   | b   | c   |', '| --- | --- | --- |', '| 1   |     |     |'].join('\n'),
        );
    });

    it('preserves surrounding prose and blank lines', () => {
        const input = [
            '# Doc',
            '',
            'Intro paragraph.',
            '',
            '| k | v |',
            '|-|-|',
            '| a | 1 |',
            '',
            'Outro.',
        ].join('\n');
        expect(formatMarkdownTables(input)).toBe(
            [
                '# Doc',
                '',
                'Intro paragraph.',
                '',
                '| k   | v   |',
                '| --- | --- |',
                '| a   | 1   |',
                '',
                'Outro.',
            ].join('\n'),
        );
    });

    it('formats multiple independent tables', () => {
        const input = [
            '| a | b |',
            '|-|-|',
            '| 1 | 2 |',
            '',
            '| ccc | d |',
            '|-|-|',
            '| e | fff |',
        ].join('\n');
        const out = formatMarkdownTables(input).split('\n');
        expect(out).toEqual([
            '| a   | b   |',
            '| --- | --- |',
            '| 1   | 2   |',
            '',
            '| ccc | d   |',
            '| --- | --- |',
            '| e   | fff |',
        ]);
        expect(findTableEdits(input)).toHaveLength(2);
    });

    it('preserves indentation of a 2-space indented table', () => {
        const input = ['  | a | b |', '  | - | - |', '  | 1 | 2 |'].join('\n');
        expect(formatMarkdownTables(input)).toBe(
            ['  | a   | b   |', '  | --- | --- |', '  | 1   | 2   |'].join('\n'),
        );
    });

    it('skips blockquoted tables', () => {
        const input = ['> | a | b |', '> | - | - |', '> | 1 | 2 |'].join('\n');
        expect(findTableEdits(input)).toHaveLength(0);
    });

    it('handles a header/delimiter-only table with no body', () => {
        const input = ['| a | bb |', '| - | - |'].join('\n');
        expect(formatMarkdownTables(input)).toBe(
            ['| a   | bb  |', '| --- | --- |'].join('\n'),
        );
    });

    it('does not treat mismatched header/delimiter counts as a table', () => {
        const input = ['| a | b | c |', '| - | - |', '| 1 | 2 | 3 |'].join('\n');
        expect(findTableEdits(input)).toHaveLength(0);
    });

    it('reports inclusive 0-based line ranges', () => {
        const input = ['intro', '', '| a | b |', '|-|-|', '| 1 | 2 |', '', 'end'].join('\n');
        const edits = findTableEdits(input);
        expect(edits).toHaveLength(1);
        expect(edits[0].fromLine).toBe(2);
        expect(edits[0].toLine).toBe(4);
    });
});

describe('buildEmptyTable', () => {
    it('builds a header + body rows of the requested size', () => {
        expect(buildEmptyTable(2, 2)).toBe(
            ['| Header 1 | Header 2 |', '| -------- | -------- |', '|          |          |'].join('\n'),
        );
    });

    it('builds a header-only table for a single row', () => {
        expect(buildEmptyTable(1, 3)).toBe(
            ['| Header 1 | Header 2 | Header 3 |', '| -------- | -------- | -------- |'].join('\n'),
        );
    });

    it('produces a table that round-trips through the formatter', () => {
        const table = buildEmptyTable(3, 4);
        expect(formatMarkdownTables(table)).toBe(table);
    });
});

describe('parseTableAt', () => {
    const doc = ['intro', '', '| a | b |', '| - | - |', '| 1 | 2 |', '', 'end'].join('\n');

    it('finds the table spanning the given line', () => {
        expect(parseTableAt(doc, 3)?.fromLine).toBe(2);
        expect(parseTableAt(doc, 2)?.headerCells).toEqual(['a', 'b']);
    });

    it('returns null off the table', () => {
        expect(parseTableAt(doc, 0)).toBeNull();
        expect(parseTableAt(doc, 6)).toBeNull();
    });
});

describe('insertRowBelow', () => {
    const doc = ['| a   | b   |', '| --- | --- |', '| 1   | 2   |'].join('\n');

    it('inserts an empty row at the top of the body when on the header', () => {
        const table = parseTableAt(doc, 0)!;
        const result = insertRowBelow(table, 0);
        expect(result.text.split('\n')).toEqual([
            '| a   | b   |',
            '| --- | --- |',
            '|     |     |',
            '| 1   | 2   |',
        ]);
        expect(result.cursorRow).toBe(2);
        expect(result.cursorCol).toBe(0);
    });

    it('inserts below the caret body row', () => {
        const table = parseTableAt(doc, 2)!;
        const result = insertRowBelow(table, 2);
        expect(result.text.split('\n')).toEqual([
            '| a   | b   |',
            '| --- | --- |',
            '| 1   | 2   |',
            '|     |     |',
        ]);
        expect(result.cursorRow).toBe(3);
    });
});

describe('insertColumnRight', () => {
    const doc = ['| a   | b   |', '| --- | --- |', '| 1   | 2   |'].join('\n');

    it('inserts an empty column to the right of the caret column', () => {
        const table = parseTableAt(doc, 0)!;
        const result = insertColumnRight(table, 0);
        expect(result.text.split('\n')).toEqual([
            '| a   |     | b   |',
            '| --- | --- | --- |',
            '| 1   |     | 2   |',
        ]);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(1);
    });

    it('appends a column when the caret is in the last column', () => {
        const table = parseTableAt(doc, 0)!;
        const result = insertColumnRight(table, 1);
        expect(result.text.split('\n')[0]).toBe('| a   | b   |     |');
        expect(result.cursorCol).toBe(2);
    });
});

describe('columnIndexAt', () => {
    it('maps a caret offset to a table column (with outer pipes)', () => {
        const line = '| a   | b   | c   |';
        expect(columnIndexAt(line, 2)).toBe(0); // in "a"
        expect(columnIndexAt(line, 8)).toBe(1); // in "b"
        expect(columnIndexAt(line, 14)).toBe(2); // in "c"
        expect(columnIndexAt(line, 0)).toBe(0); // on the leading pipe
    });

    it('maps a caret offset without outer pipes', () => {
        const line = 'a | b | c';
        expect(columnIndexAt(line, 0)).toBe(0);
        expect(columnIndexAt(line, 4)).toBe(1);
        expect(columnIndexAt(line, 8)).toBe(2);
    });

    it('ignores escaped pipes', () => {
        const line = '| x \\| y | z   |';
        expect(columnIndexAt(line, 5)).toBe(0); // still in the first cell
    });
});

describe('cellContentStart', () => {
    it('locates the start of a rendered cell', () => {
        const line = '| a   | b   |';
        expect(cellContentStart(line, 0)).toBe(2);
        expect(cellContentStart(line, 1)).toBe(8);
    });
});
