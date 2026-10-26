/**
 * Rewriting a single fenced code block inside a markdown document, given the
 * source range the renderer reported for it.
 *
 * The delicate parts are all about not corrupting the rest of the document: the
 * fence has to stay long enough to survive a body that contains fences of its
 * own (an archdia block carries ```plantuml and ```json inside it), and a fence
 * nested in a list or a blockquote has to keep its line prefix.
 */

/** Offsets of a whole fence — markers included — in the markdown source. */
export interface FencedBlockRange {
    start: number;
    end: number;
}

/** A replacement to apply to the markdown source. */
export interface FencedBlockEdit {
    from: number;
    to: number;
    text: string;
}

const FENCE_HEAD = /^(`{3,}|~{3,})[ \t]*([^\s`]*)/;

/** Length of the longest run of `char` anywhere in `text`. */
const longestRun = (text: string, char: string): number => {
    let longest = 0;
    let current = 0;
    for (const c of text) {
        current = c === char ? current + 1 : 0;
        if (current > longest) longest = current;
    }
    return longest;
};

/**
 * Build the replacement for the fenced `language` block at `range`.
 *
 * `newLanguage` retags the fence, for a body that is no longer written in the
 * language it was read as — a mermaid diagram taken through the archdia editor
 * comes back as archdia, and the fence has to say so or the renderer will hand
 * the new body to the wrong component.
 *
 * Returns `null` when `range` no longer holds a fence of that language — the
 * source moved under the caller (an edit landed while the dialog was open, say)
 * and splicing blind would eat unrelated text. Callers should report that
 * rather than write.
 */
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

    // The fence keeps its own style and always outgrows any run the new body
    // holds. Beyond that it keeps its width — except when the block is retagged:
    // a body of another kind says nothing about the width the old one needed, and
    // an archdia block extracted as plantuml no longer carries fences of its own.
    const fenceChar = head[1][0];
    const minLength = newLanguage === language ? head[1].length : 3;
    const fence = fenceChar.repeat(Math.max(minLength, longestRun(body, fenceChar) + 1));

    // A fence inside a list item or a blockquote starts mid-line; every line of
    // the replacement needs the same prefix to stay inside its container.
    const lineStart = source.lastIndexOf('\n', range.start - 1) + 1;
    const prefix = source.slice(lineStart, range.start);
    const eol = original.includes('\r\n') ? '\r\n' : '\n';

    // The serializers end their output with a newline; keeping it would leave a
    // blank line before the closing fence on every round trip.
    const lines = [fence + newLanguage, ...body.replace(/(\r?\n)+$/, '').split(/\r?\n/), fence];
    const text = lines.map((line, i) => (i === 0 || prefix === '' ? line : prefix + line)).join(eol);

    return { from: range.start, to: range.end, text };
};
