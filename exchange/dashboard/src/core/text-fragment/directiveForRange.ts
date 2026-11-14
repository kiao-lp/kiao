/** Builds the smallest directive that matches the selection and nothing before it. Long or multi-block passages use `start,end`; context grows word by word up to a cap. */

import { DocumentText, rangeIndices, BLOCK_BREAK } from './documentText';
import { isWordCharacter, matchIndices } from './matchTextDirective';
import { TextDirective } from './textDirective';

/** Above this word count, quote by ends only. */
const QUOTE_WHOLE_BELOW = 12;

/** How many words each end carries when the passage is named by its ends. */
const EDGE_WORDS = 5;

/** How far context is grown before a link is settled for as it stands. */
const MAX_CONTEXT_WORDS = 10;

const wordsOf = (text: string): string[] => text.split(' ').filter(Boolean);

/** Block bounds for `at`; no term may cross them. */
const blockStart = (text: string, at: number): number => text.lastIndexOf(BLOCK_BREAK, at - 1) + 1;
const blockEnd = (text: string, at: number): number => {
    const found = text.indexOf(BLOCK_BREAK, at);
    return found < 0 ? text.length : found;
};

/** First `count` words from `at`, clipped at block end. */
const openingWords = (text: string, at: number, count: number): string =>
    wordsOf(text.slice(at, blockEnd(text, at))).slice(0, count).join(' ');

/** Last `count` words before `at`, clipped at block start. */
const closingWords = (text: string, at: number, count: number): string => {
    const words = wordsOf(text.slice(blockStart(text, at), at));
    return words.slice(Math.max(0, words.length - count)).join(' ');
};

/** Trims whitespace and block breaks at selection edges. */
const trimEdges = (text: string, from: number, to: number): [number, number] => {
    let start = from;
    let stop = to;
    while (start < stop && (text[start] === ' ' || text[start] === BLOCK_BREAK)) start++;
    while (stop > start && (text[stop - 1] === ' ' || text[stop - 1] === BLOCK_BREAK)) stop--;
    return [start, stop];
};

/** Expands to whole words; directives resolve only on word boundaries. */
const snapToWords = (text: string, from: number, to: number): [number, number] => {
    let start = from;
    let stop = to;
    while (start > 0 && isWordCharacter(text[start - 1]) && isWordCharacter(text[start])) start--;
    while (stop < text.length && isWordCharacter(text[stop - 1]) && isWordCharacter(text[stop])) stop++;
    return [start, stop];
};

/** True when the directive first matches at `from`. */
const resolvesTo = (text: string, directive: TextDirective, from: number): boolean => {
    const found = matchIndices(text, directive);
    return found !== null && found[0] === from;
};

/** Quotes whole when short; otherwise uses both ends. */
const quote = (text: string, from: number, to: number): TextDirective => {
    const passage = text.slice(from, to);
    const words = wordsOf(passage.split(BLOCK_BREAK).join(' '));
    if (!passage.includes(BLOCK_BREAK) && words.length <= QUOTE_WHOLE_BELOW) return { start: passage };
    return {
        start: openingWords(text, from, EDGE_WORDS),
        end: closingWords(text, to, EDGE_WORDS),
    };
};

/** Directive for `range`, or `null` if it covers no document text. */
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

    // Still ambiguous; return the quote (opens on first match).
    return bare;
};

