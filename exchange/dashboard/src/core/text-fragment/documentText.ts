/** Flattens rendered DOM to one searchable string with a per-character index back to the DOM. Whitespace collapses to one space; case folds 1:1 (lengthening folds like `İ` stay unfolded); blocks are separated by `\n`, which no term may span. */

/** Skipped: UI chrome or non-text. */
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'BUTTON', 'SVG', 'TEXTAREA', 'SELECT']);

/** Block edges bound a single term. */
const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DETAILS', 'DIV', 'DL', 'DT',
    'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE',
    'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

/** Block boundary marker; a term spanning it is rejected. */
export const BLOCK_BREAK = '\n';

/** Flat text plus per-character DOM index; `-1` marks block boundaries. */
export interface DocumentText {
    text: string;
    nodes: Text[];
    nodeOf: number[];
    offsetOf: number[];
}

/** Lowercases only when the fold stays one character. */
const foldCase = (character: string): string => {
    const folded = character.toLowerCase();
    return folded.length === 1 ? folded : character;
};

const isDrawn = (element: Element): boolean =>
    !SKIPPED_TAGS.has(element.tagName.toUpperCase())
    && !element.hasAttribute('hidden')
    && element.getAttribute('aria-hidden') !== 'true';

/** Reads `root`; cheap enough to redo on every change. */
export const readDocumentText = (root: Element): DocumentText => {
    const characters: string[] = [];
    const nodeOf: number[] = [];
    const offsetOf: number[] = [];
    const nodes: Text[] = [];

    const push = (character: string, node: number, offset: number) => {
        characters.push(character);
        nodeOf.push(node);
        offsetOf.push(offset);
    };

    // Boundary only between blocks with text on both sides.
    const breakLine = () => {
        const last = characters[characters.length - 1];
        if (last === undefined || last === BLOCK_BREAK) return;
        if (last === ' ') { characters.pop(); nodeOf.pop(); offsetOf.pop(); }
        push(BLOCK_BREAK, -1, 0);
    };

    const readText = (node: Text, index: number) => {
        const raw = node.data;
        for (let i = 0; i < raw.length; i++) {
            const character = raw[i];
            if (/\s/.test(character)) {
                // Whitespace run collapses to one space; never leading or after a boundary.
                const last = characters[characters.length - 1];
                if (last === undefined || last === ' ' || last === BLOCK_BREAK) continue;
                push(' ', index, i);
            } else {
                push(foldCase(character), index, i);
            }
        }
    };

    const walk = (element: Element) => {
        for (const child of Array.from(element.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
                const node = child as Text;
                if (!node.data) continue;
                nodes.push(node);
                readText(node, nodes.length - 1);
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const nested = child as Element;
                if (!isDrawn(nested)) continue;
                const block = BLOCK_TAGS.has(nested.tagName.toUpperCase());
                if (block) breakLine();
                walk(nested);
                if (block) breakLine();
            }
        }
    };

    walk(root);
    // Drop trailing boundary.
    if (characters[characters.length - 1] === BLOCK_BREAK) { characters.pop(); nodeOf.pop(); offsetOf.pop(); }
    return { text: characters.join(''), nodes, nodeOf, offsetOf };
};

/** DOM range for `[from, to)`, or `null` if an end is a block boundary. */
export const rangeOf = (document_: DocumentText, from: number, to: number): Range | null => {
    if (from < 0 || to > document_.text.length || to <= from) return null;
    const first = document_.nodeOf[from];
    const last = document_.nodeOf[to - 1];
    if (first < 0 || last < 0) return null;

    const range = document.createRange();
    range.setStart(document_.nodes[first], document_.offsetOf[from]);
    range.setEnd(document_.nodes[last], document_.offsetOf[to - 1] + 1);
    return range;
};

/** `comparePoint` throws for unknown nodes; treat as outside. */
const holds = (range: Range, node: Text, offset: number): boolean => {
    try {
        return range.comparePoint(node, offset) >= 0 && range.comparePoint(node, offset + 1) <= 0;
    } catch {
        return false;
    }
};

const touches = (range: Range, node: Text): boolean => {
    try {
        return range.intersectsNode(node);
    } catch {
        return false;
    }
};

/** `[from, to)` of a DOM range in flat text, or `null` if it covers no read character. Only touched nodes are range-tested. */
export const rangeIndices = (document_: DocumentText, range: Range): [number, number] | null => {
    let from = -1;
    let to = -1;
    let node = -1;
    let inside = false;

    for (let i = 0; i < document_.text.length; i++) {
        const at = document_.nodeOf[i];
        if (at < 0) continue;
        if (at !== node) {
            node = at;
            inside = touches(range, document_.nodes[at]);
        }
        if (!inside) continue;
        if (!holds(range, document_.nodes[at], document_.offsetOf[i])) continue;
        if (from < 0) from = i;
        to = i + 1;
    }

    return from < 0 ? null : [from, to];
};
