/** Reformats GFM tables. Width is code points, not glyph width; tables end at a blank line or EOF; indented (4+) and blockquoted tables are skipped. */

export type ColumnAlign = 'left' | 'right' | 'center' | 'none';

export interface TableEdit {
    /** 0-based, inclusive line index where the table starts. */
    fromLine: number;
    /** 0-based, inclusive line index where the table ends. */
    toLine: number;
    /** Reformatted table, lines joined with '\n', no trailing newline. */
    text: string;
}

const DELIM_CELL = /^:?-+:?$/;

// Split a row into trimmed cells; `\|` is not a separator.
function splitCells(line: string): string[] {
    const cells: string[] = [];
    let cur = '';
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '\\' && i + 1 < line.length) {
            cur += ch + line[i + 1];
            i++;
            continue;
        }
        if (ch === '|') {
            cells.push(cur);
            cur = '';
            continue;
        }
        cur += ch;
    }
    cells.push(cur);

    const trimmed = line.trim();
    if (cells.length > 1 && cells[0].trim() === '' && trimmed.startsWith('|')) {
        cells.shift();
    }
    if (cells.length > 1 && cells[cells.length - 1].trim() === '' && trimmed.endsWith('|')) {
        cells.pop();
    }
    return cells.map((c) => c.trim());
}

function parseAlignments(line: string): ColumnAlign[] | null {
    const cells = splitCells(line);
    if (cells.length === 0 || (cells.length === 1 && cells[0] === '')) {
        return null;
    }
    const aligns: ColumnAlign[] = [];
    for (const cell of cells) {
        if (!DELIM_CELL.test(cell)) {
            return null;
        }
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');
        aligns.push(left && right ? 'center' : right ? 'right' : left ? 'left' : 'none');
    }
    return aligns;
}

// Code-point length; wide glyphs are not measured.
function displayWidth(s: string): number {
    return Array.from(s).length;
}

function padCell(cell: string, width: number, align: ColumnAlign): string {
    const space = Math.max(0, width - displayWidth(cell));
    if (align === 'right') {
        return ' '.repeat(space) + cell;
    }
    if (align === 'center') {
        const left = Math.floor(space / 2);
        return ' '.repeat(left) + cell + ' '.repeat(space - left);
    }
    return cell + ' '.repeat(space);
}

function delimiterCell(width: number, align: ColumnAlign): string {
    const w = Math.max(width, 3);
    if (align === 'center') {
        return ':' + '-'.repeat(w - 2) + ':';
    }
    if (align === 'right') {
        return '-'.repeat(w - 1) + ':';
    }
    if (align === 'left') {
        return ':' + '-'.repeat(w - 1);
    }
    return '-'.repeat(w);
}

function renderTable(
    indent: string,
    headerCells: string[],
    aligns: ColumnAlign[],
    bodyRows: string[][],
): string[] {
    const numCols = Math.max(headerCells.length, ...bodyRows.map((r) => r.length));
    const cellAt = (row: string[], c: number) => (c < row.length ? row[c] : '');
    const alignAt = (c: number): ColumnAlign => (c < aligns.length ? aligns[c] : 'none');

    // Minimum width 3 so the delimiter is at least `---`.
    const widths: number[] = [];
    for (let c = 0; c < numCols; c++) {
        let w = displayWidth(cellAt(headerCells, c));
        for (const row of bodyRows) {
            w = Math.max(w, displayWidth(cellAt(row, c)));
        }
        widths.push(Math.max(w, 3));
    }

    const cols = Array.from({ length: numCols }, (_, c) => c);
    const renderRow = (row: string[]) =>
        indent + '| ' + cols.map((c) => padCell(cellAt(row, c), widths[c], alignAt(c))).join(' | ') + ' |';

    const lines: string[] = [];
    lines.push(renderRow(headerCells));
    lines.push(indent + '| ' + cols.map((c) => delimiterCell(widths[c], alignAt(c))).join(' | ') + ' |');
    for (const row of bodyRows) {
        lines.push(renderRow(row));
    }
    return lines;
}

export interface ParsedTable {
    /** 0-based, inclusive. */
    fromLine: number;
    /** 0-based, inclusive. */
    toLine: number;
    indent: string;
    headerCells: string[];
    aligns: ColumnAlign[];
    bodyRows: string[][];
}

/** All GFM tables in document order, without overlaps. */
export function scanTables(text: string): ParsedTable[] {
    const lines = text.split('\n');
    const tables: ParsedTable[] = [];

    let i = 0;
    while (i < lines.length) {
        const header = lines[i];
        const delim = lines[i + 1];
        const indent = (header.match(/^\s*/)?.[0]) ?? '';

        const looksLikeTableStart =
            delim !== undefined &&
            header.trim() !== '' &&
            indent.length < 4 &&
            !header.trim().startsWith('>') &&
            // A pipe is required, else `Title`/`-----` looks like a setext heading.
            (header.includes('|') || delim.includes('|'));

        if (looksLikeTableStart) {
            const aligns = parseAlignments(delim);
            const headerCells = splitCells(header);
            // Header and delimiter column counts must match.
            if (aligns && aligns.length === headerCells.length) {
                let end = i + 1;
                const bodyRows: string[][] = [];
                for (let j = i + 2; j < lines.length && lines[j].trim() !== ''; j++) {
                    bodyRows.push(splitCells(lines[j]));
                    end = j;
                }
                tables.push({ fromLine: i, toLine: end, indent, headerCells, aligns, bodyRows });
                i = end + 1;
                continue;
            }
        }
        i++;
    }
    return tables;
}

/** Reformatted replacement per table, in document order, non-overlapping. */
export function findTableEdits(text: string): TableEdit[] {
    return scanTables(text).map((t) => ({
        fromLine: t.fromLine,
        toLine: t.toLine,
        text: renderTable(t.indent, t.headerCells, t.aligns, t.bodyRows).join('\n'),
    }));
}

/** Table containing 0-based `lineIndex`, or null. */
export function parseTableAt(text: string, lineIndex: number): ParsedTable | null {
    for (const t of scanTables(text)) {
        if (lineIndex >= t.fromLine && lineIndex <= t.toLine) {
            return t;
        }
    }
    return null;
}

export interface TableEditResult {
    /** Lines joined with '\n', no trailing newline. */
    text: string;
    /** 0-based line within `text`. */
    cursorRow: number;
    /** 0-based table column. */
    cursorCol: number;
}

/** Empty table; `rows` includes the header. */
export function buildEmptyTable(rows: number, cols: number, indent = ''): string {
    const nCols = Math.max(1, cols);
    const nBody = Math.max(0, rows - 1);
    const headerCells = Array.from({ length: nCols }, (_, c) => `Header ${c + 1}`);
    const aligns: ColumnAlign[] = Array.from({ length: nCols }, () => 'none');
    const bodyRows = Array.from({ length: nBody }, () => Array.from({ length: nCols }, () => ''));
    return renderTable(indent, headerCells, aligns, bodyRows).join('\n');
}

/** Insert an empty body row below the caret row; on the header/delimiter, at the top of the body. `docLine` is 0-based. */
export function insertRowBelow(table: ParsedTable, docLine: number): TableEditResult {
    // fromLine = header, fromLine+1 = delimiter, fromLine+2.. = body rows.
    const bodyIndexAtCursor = docLine - (table.fromLine + 2);
    const insertAt = Math.max(0, bodyIndexAtCursor + 1);
    const newRow = table.headerCells.map(() => '');
    const bodyRows = [...table.bodyRows];
    bodyRows.splice(insertAt, 0, newRow);
    const lines = renderTable(table.indent, table.headerCells, table.aligns, bodyRows);
    return { text: lines.join('\n'), cursorRow: 2 + insertAt, cursorCol: 0 };
}

export function insertColumnRight(table: ParsedTable, colIndex: number): TableEditResult {
    const numCols = Math.max(
        table.headerCells.length,
        ...table.bodyRows.map((r) => r.length),
        colIndex + 1,
    );
    const at = Math.min(Math.max(colIndex, 0) + 1, numCols);
    const headerCells = [...table.headerCells];
    headerCells.splice(at, 0, '');
    const aligns = [...table.aligns];
    aligns.splice(Math.min(at, aligns.length), 0, 'none');
    const bodyRows = table.bodyRows.map((r) => {
        const row = [...r];
        while (row.length < at) {
            row.push('');
        }
        row.splice(at, 0, '');
        return row;
    });
    const lines = renderTable(table.indent, headerCells, aligns, bodyRows);
    return { text: lines.join('\n'), cursorRow: 0, cursorCol: at };
}

/** 0-based column for a char offset; `\|` does not count as a separator. */
export function columnIndexAt(line: string, char: number): number {
    const hasLeadingPipe = line.trim().startsWith('|');
    let pipes = 0;
    for (let i = 0; i < char && i < line.length; i++) {
        if (line[i] === '\\') {
            i++;
            continue;
        }
        if (line[i] === '|') {
            pipes++;
        }
    }
    return Math.max(0, pipes - (hasLeadingPipe ? 1 : 0));
}

/** Char offset of column content on a rendered table line. */
export function cellContentStart(lineText: string, colIndex: number): number {
    let pipes = 0;
    for (let i = 0; i < lineText.length; i++) {
        if (lineText[i] === '\\') {
            i++;
            continue;
        }
        if (lineText[i] === '|') {
            pipes++;
            if (pipes === colIndex + 1) {
                return Math.min(lineText.length, i + 2);
            }
        }
    }
    return lineText.length;
}

/** Return `text` with every GFM table reformatted. */
export function formatMarkdownTables(text: string): string {
    const lines = text.split('\n');
    const edits = findTableEdits(text);
    for (let k = edits.length - 1; k >= 0; k--) {
        const e = edits[k];
        lines.splice(e.fromLine, e.toLine - e.fromLine + 1, ...e.text.split('\n'));
    }
    return lines.join('\n');
}
