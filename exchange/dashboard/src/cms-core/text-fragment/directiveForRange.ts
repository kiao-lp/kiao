/**
 * Naming the passage a reader has selected — the copy side of a text fragment link.
 *
 * The hard part is not writing the terms out but choosing them. A link is worth having only if it
 * lands where it was made, so the directive must match the selected passage **and nothing before
 * it** in the document. This builds the smallest one that does:
 *
 *  1. quote the passage — whole while it is short, by its two ends once it is long or crosses a
 *     paragraph, since a URL carrying a whole section is a URL nobody will paste;
 *  2. try it. If the first match in the document is the passage itself, that is the link;
 *  3. otherwise grow context a word at a time, before and after, until the quote is the only
 *     reading of it.
 *
 * Beyond a cap the search gives up and returns the ambiguous quote anyway. A link that opens on the
 * wrong one of two identical sentences is still a link to the right words, and is better than none.
 */

import { DocumentText, rangeIndices, BLOCK_BREAK } from './documentText';
import { isWordCharacter, matchIndices } from './matchTextDirective';
import { TextDirective } from './textDirective';

/** Beyond this many words the passage is named by its two ends rather than quoted whole. */
const QUOTE_WHOLE_BELOW = 12;

/** How many words each end carries when the passage is named by its ends. */
const EDGE_WORDS = 5;

/** How far context is grown before a link is settled for as it stands. */
const MAX_CONTEXT_WORDS = 10;

const wordsOf = (text: string): string[] => text.split(' ').filter(Boolean);

/** Where the block holding `at` starts and ends: no term may reach outside it. */
const blockStart = (text: string, at: number): number => text.lastIndexOf(BLOCK_BREAK, at - 1) + 1;
const blockEnd = (text: string, at: number): number => {
    const found = text.indexOf(BLOCK_BREAK, at);
    return found < 0 ? text.length : found;
};

/** The first `count` words from `at`, stopping at the end of the block. */
const openingWords = (text: string, at: number, count: number): string =>
    wordsOf(text.slice(at, blockEnd(text, at))).slice(0, count).join(' ');

/** The last `count` words before `at`, starting no earlier than the block does. */
const closingWords = (text: string, at: number, count: number): string => {
    const words = wordsOf(text.slice(blockStart(text, at), at));
    return words.slice(Math.max(0, words.length - count)).join(' ');
};

/** The selection with its surrounding whitespace and block boundaries dropped. */
const trimEdges = (text: string, from: number, to: number): [number, number] => {
    let start = from;
    let stop = to;
    while (start < stop && (text[start] === ' ' || text[start] === BLOCK_BREAK)) start++;
    while (stop > start && (text[stop - 1] === ' ' || text[stop - 1] === BLOCK_BREAK)) stop--;
    return [start, stop];
};

/**
 * The selection grown out to whole words. Half a word matches nothing — a directive only ever
 * resolves on word boundaries — so a reader who swept through the middle of one gets the word.
 */
const snapToWords = (text: string, from: number, to: number): [number, number] => {
    let start = from;
    let stop = to;
    while (start > 0 && isWordCharacter(text[start - 1]) && isWordCharacter(text[start])) start--;
    while (stop < text.length && isWordCharacter(text[stop - 1]) && isWordCharacter(text[stop])) stop++;
    return [start, stop];
};

/** True when this directive reads the passage at `from` and reads nothing earlier. */
const resolvesTo = (text: string, directive: TextDirective, from: number): boolean => {
    const found = matchIndices(text, directive);
    return found !== null && found[0] === from;
};

/** The passage quoted: whole while that is short enough, by its two ends once it is not. */
const quote = (text: string, from: number, to: number): TextDirective => {
    const passage = text.slice(from, to);
    const words = wordsOf(passage.split(BLOCK_BREAK).join(' '));
    if (!passage.includes(BLOCK_BREAK) && words.length <= QUOTE_WHOLE_BELOW) return { start: passage };
    return {
        start: openingWords(text, from, EDGE_WORDS),
        end: closingWords(text, to, EDGE_WORDS),
    };
};

/**
 * The text directive naming what `range` covers of `document_`, or `null` when it covers no text
 * of the document at all.
 */
export const directiveForRange = (document_: DocumentText, range: Range): TextDirective | null => {
    const bounds = rangeIndices(document_, range);
    if (!bounds) return null;

    const text = document_.text;
    const [trimmedFrom, trimmedTo] = trimEdges(text, bounds[0], bounds[1]);
    if (trimmedTo <= trimmedFrom) return null;
    const [from, to] = snapToWords(text, trimmedFrom, trimmedTo);

    const bare = quote(text, from, to);
    if (!bare.start || (bare.end !== undefined && !bare.end)) return null;
    if (resolvesTo(text, bare, from)) return bare;

    for (let words = 1; words <= MAX_CONTEXT_WORDS; words++) {
        const prefix = closingWords(text, from, words);
        const suffix = openingWords(text, to, words);
        if (!prefix && !suffix) break;
        const candidate: TextDirective = {
            ...(prefix ? { prefix } : {}),
            ...bare,
            ...(suffix ? { suffix } : {}),
        };
        if (resolvesTo(text, candidate, from)) return candidate;
    }

    // Ambiguous after all that — two passages of this document really do read alike. The quote is
    // still the right words, and the link opens on the first of them.
    return bare;
};

