/** Rewrites one fenced block at a renderer-reported range. The fence outgrows any fence run in the body and keeps its line prefix. */

/** Markers included. */
export interface FencedBlockRange {
    start: number;
    end: number;
}

export interface FencedBlockEdit {
    from: number;
    to: number;
    text: string;
}

const FENCE_HEAD = /^(`{3,}|~{3,})[ \t]*([^\s`]*)/;

const longestRun = (text: string, char: string): number => {
    let longest = 0;
    let current = 0;
    for (const c of text) {
        current = c === char ? current + 1 : 0;
        if (current > longest) longest = current;
    }
    return longest;
};

/** `newLanguage` retags the fence. Returns `null` when `range` holds no fence of `language`; callers report, not write. */
export const buildFencedBlockEdit = (
    source: string,
    range: FencedBlockRange,
    language: string,
    body: string,
    newLanguage: string = language,
): FencedBlockEdit | null => {
    if (range.start < 0 || range.end > source.length || range.start >= range.end) return null;

    const original = source.slice(range.start, range.end);
    const head = FENCE_HEAD.exec(original);
    if (!head || head[2] !== language) return null;

    // On retag the width resets to 3: the old width says nothing about the new body.
    const fenceChar = head[1][0];
    const minLength = newLanguage === language ? head[1].length : 3;
    const fence = fenceChar.repeat(Math.max(minLength, longestRun(body, fenceChar) + 1));

    // Every replacement line keeps the list or blockquote prefix.
    const lineStart = source.lastIndexOf('\n', range.start - 1) + 1;
    const prefix = source.slice(lineStart, range.start);
    const eol = original.includes('\r\n') ? '\r\n' : '\n';

    // Trailing newlines are stripped; serializers add one.
    const lines = [fence + newLanguage, ...body.replace(/(\r?\n)+$/, '').split(/\r?\n/), fence];
    const text = lines.map((line, i) => (i === 0 || prefix === '' ? line : prefix + line)).join(eol);

    return { from: range.start, to: range.end, text };
};
