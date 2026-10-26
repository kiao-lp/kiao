/**
 * The rendered document as one searchable string, and the way back from it to the DOM.
 *
 * A passage named by a text directive is a run of *words*, and words in a rendered markdown
 * document are scattered across text nodes: a sentence carrying a bold word or a link is three
 * nodes, and `<p>one</p><p>two</p>` are two that must never read as "one two". Searching the DOM
 * directly would mean handling that at every comparison; reading it once into a flat string, with
 * an index back to the node each character came from, means the search is plain string work and
 * only its two endpoints ever touch the DOM again.
 *
 * What the reading does to the text, and why each of them:
 *
 *  - **whitespace is collapsed** to a single space, because the source's line wrapping is not the
 *    reader's — a sentence broken over two markdown lines is one line on screen, and a link to it
 *    must not depend on where the author happened to wrap;
 *  - **case is folded**, because a link is written from what was read and matched against what is
 *    rendered, and a heading may be capitalised by CSS at either end;
 *  - **blocks are separated by a newline**, which no term may contain, so that a match can never
 *    run from the end of one paragraph into the start of the next.
 *
 * Case folding keeps one character per character — the few that lengthen when lowercased (Turkish
 * `İ` is the usual example) are left as they are rather than break the index. They then only match
 * themselves, which for a link copied out of the same document is exactly right.
 */

/** Not part of what is read: chrome the renderer draws around the document, or not text at all. */
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'BUTTON', 'SVG', 'TEXTAREA', 'SELECT']);

/** Elements whose edges end a line of prose, and so bound what a single term may match. */
const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DETAILS', 'DIV', 'DL', 'DT',
    'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE',
    'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

/** The character standing for a block boundary. A term is rejected if it would span one. */
export const BLOCK_BREAK = '\n';

/**
 * A rendered document read flat. `nodeOf` and `offsetOf` are as long as `text` and answer, for
 * every character of it, where in the DOM it came from — `-1` for the block boundaries, which came
 * from nowhere.
 */
export interface DocumentText {
    text: string;
    nodes: Text[];
    nodeOf: number[];
    offsetOf: number[];
}

/** Lowercased where that costs no character, left alone where it would cost one. See the header. */
const foldCase = (character: string): string => {
    const folded = character.toLowerCase();
    return folded.length === 1 ? folded : character;
};

const isDrawn = (element: Element): boolean =>
    !SKIPPED_TAGS.has(element.tagName.toUpperCase())
    && !element.hasAttribute('hidden')
    && element.getAttribute('aria-hidden') !== 'true';

/** Reads `root` and everything it holds. Cheap enough to redo whenever the document changes. */
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

    /** A boundary is worth writing only between two blocks that have text on both sides of it. */
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
                // A run of whitespace, wherever it is broken across nodes, is one space — and
                // never the first character, nor one following a boundary.
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
    // The boundary after the last block bounds nothing: dropped, so the read text ends on the
    // document rather than on a break.
    if (characters[characters.length - 1] === BLOCK_BREAK) { characters.pop(); nodeOf.pop(); offsetOf.pop(); }
    return { text: characters.join(''), nodes, nodeOf, offsetOf };
};

/**
 * The DOM range covering `[from, to)` of the read text, or `null` when either end is a block
 * boundary rather than a character of the document.
 */
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

/** `comparePoint` throws for a node the range knows nothing about; such a node is simply outside. */
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

/**
 * Where a DOM range falls in the read text, as `[from, to)`, or `null` when it covers no character
 * of it — a selection made entirely inside something not read, an image caption button.
 *
 * The characters are walked in document order, but the costly question — is this point inside the
 * range? — is asked only of nodes the range actually touches, which for a selection is a handful.
 */
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
