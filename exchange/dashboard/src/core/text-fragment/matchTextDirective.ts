/** Finds a directive's passage in flat text. Matches start/end on word boundaries; no term spans a block (`start,end` may). `prefix`/`suffix` must sit immediately beside the passage. */

import { BLOCK_BREAK, DocumentText, rangeOf } from './documentText';
import { TextDirective } from './textDirective';

/** Word characters (Unicode-aware). */
const WORD = /[\p{L}\p{N}_]/u;

export const isWordCharacter = (character: string | undefined): boolean =>
    character !== undefined && WORD.test(character);

/** True unless `index` cuts through a word; punctuation crossings stay allowed. */
export const isWordBoundary = (text: string, index: number): boolean =>
    index <= 0
    || index >= text.length
    || !(isWordCharacter(text[index - 1]) && isWordCharacter(text[index]));

/** Normalizes a term the same way the document was read. */
export const normalizeTerm = (term: string): string => {
    let folded = '';
    for (const character of term.replace(/\s+/g, ' ').trim()) {
        const lower = character.toLowerCase();
        folded += lower.length === 1 ? lower : character;
    }
    return folded;
};

/** First whole-word occurrence of `term` at or after `from`. */
const findTerm = (text: string, term: string, from: number): number => {
    for (let at = text.indexOf(term, from); at >= 0; at = text.indexOf(term, at + 1)) {
        if (isWordBoundary(text, at) && isWordBoundary(text, at + term.length)) return at;
    }
    return -1;
};

/** Skips separating spaces, never past block end. */
const skipSpaces = (text: string, from: number): number => {
    let at = from;
    while (text[at] === ' ') at++;
    return at;
};

/** True when `term` sits whole at `at` without crossing a block. */
const sits = (text: string, term: string, at: number): boolean =>
    text.startsWith(term, at) && isWordBoundary(text, at) && isWordBoundary(text, at + term.length);

/** `[from, to)` of the passage, or `null` if absent. First candidate satisfying every term wins. */
export const matchIndices = (text: string, directive: TextDirective): [number, number] | null => {
    const start = normalizeTerm(directive.start);
    if (!start || start.includes(BLOCK_BREAK)) return null;
    const end = directive.end ? normalizeTerm(directive.end) : '';
    const prefix = directive.prefix ? normalizeTerm(directive.prefix) : '';
    const suffix = directive.suffix ? normalizeTerm(directive.suffix) : '';

    let searchFrom = 0;
    for (;;) {
        let from: number;
        if (prefix) {
            // Search by prefix; passage must follow it.
            const at = findTerm(text, prefix, searchFrom);
            if (at < 0) return null;
            searchFrom = at + 1;
            from = skipSpaces(text, at + prefix.length);
            if (!sits(text, start, from)) continue;
        } else {
            from = findTerm(text, start, searchFrom);
            if (from < 0) return null;
            searchFrom = from + 1;
        }

        // With `end`, everything from `start` to `end` belongs to the passage, breaks included.
        let to = from + start.length;
        if (end) {
            const at = findTerm(text, end, to);
            if (at < 0) return null;
            to = at + end.length;
        }

        if (suffix && !sits(text, suffix, skipSpaces(text, to))) continue;
        return [from, to];
    }
};

/** Passage as a DOM range. */
export const matchTextDirective = (document_: DocumentText, directive: TextDirective): Range | null => {
    const found = matchIndices(document_.text, directive);
    return found ? rangeOf(document_, found[0], found[1]) : null;
};

/** First directive the document still holds. */
export const matchTextFragment = (document_: DocumentText, directives: TextDirective[]): Range | null => {
    for (const directive of directives) {
        const range = matchTextDirective(document_, directive);
        if (range) return range;
    }
    return null;
};
