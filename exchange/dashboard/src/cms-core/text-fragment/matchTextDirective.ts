/**
 * Finding the passage a text directive names, in a document read by `documentText.ts`.
 *
 * Two rules make a quote mean what a reader would take it to mean, and both are the
 * specification's:
 *
 *  - a match starts and ends on a **word boundary**, so `text=cat` finds the animal and not the
 *    middle of "concatenate" — the link was written from words, and words are what it finds;
 *  - a **term never spans a block**, so `prefix` and `start` must be in the same paragraph, and so
 *    must `suffix` and whatever it follows. A passage as a whole may still run across paragraphs:
 *    that is what the `start,end` form is for.
 *
 * `prefix` and `suffix`, when present, must sit immediately either side of the passage — nothing
 * but spaces between. They are context, not a second search.
 */

import { BLOCK_BREAK, DocumentText, rangeOf } from './documentText';
import { TextDirective } from './textDirective';

/** What counts as inside a word. Unicode-aware: a link into French or Greek must behave. */
const WORD = /[\p{L}\p{N}_]/u;

export const isWordCharacter = (character: string | undefined): boolean =>
    character !== undefined && WORD.test(character);

/**
 * True when a match may start or end at `index`: anywhere but in the middle of a word. Stated as
 * what it forbids rather than as a change of character class, so that a term reaching over
 * punctuation — the `(` opening a parenthesis, the `,` a context term ends on — is still allowed
 * to sit where it does. It is words that must not be cut through, and only words.
 */
export const isWordBoundary = (text: string, index: number): boolean =>
    index <= 0
    || index >= text.length
    || !(isWordCharacter(text[index - 1]) && isWordCharacter(text[index]));

/**
 * A term as it will be compared: read the same way the document was, so that a link written from
 * one browser's rendering resolves against another's.
 */
export const normalizeTerm = (term: string): string => {
    let folded = '';
    for (const character of term.replace(/\s+/g, ' ').trim()) {
        const lower = character.toLowerCase();
        folded += lower.length === 1 ? lower : character;
    }
    return folded;
};

/** The first occurrence of `term` at or after `from` that a reader would call a whole match. */
const findTerm = (text: string, term: string, from: number): number => {
    for (let at = text.indexOf(term, from); at >= 0; at = text.indexOf(term, at + 1)) {
        if (isWordBoundary(text, at) && isWordBoundary(text, at + term.length)) return at;
    }
    return -1;
};

/** Past the spaces that separate a term from its context — but never past the end of the block. */
const skipSpaces = (text: string, from: number): number => {
    let at = from;
    while (text[at] === ' ') at++;
    return at;
};

/** True when `term` sits at `at`, whole, and does not run into the next block. */
const sits = (text: string, term: string, at: number): boolean =>
    text.startsWith(term, at) && isWordBoundary(text, at) && isWordBoundary(text, at + term.length);

/**
 * Where the passage lies in `text`, as `[from, to)`, or `null` when the document no longer holds
 * it. The first candidate satisfying every term wins, which is what makes context worth adding:
 * without it, a link to the second "see below" opens on the first.
 */
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
            // With context, the prefix is what is searched for and the passage must follow it.
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

        // `start` alone is the whole passage; with `end` it is only its opening, and everything
        // down to the closing words belongs to it — paragraph breaks included.
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

/** The passage as a DOM range, ready to be painted and scrolled to. */
export const matchTextDirective = (document_: DocumentText, directive: TextDirective): Range | null => {
    const found = matchIndices(document_.text, directive);
    return found ? rangeOf(document_, found[0], found[1]) : null;
};

/** The first of `directives` the document still holds — a fragment may name several passages. */
export const matchTextFragment = (document_: DocumentText, directives: TextDirective[]): Range | null => {
    for (const directive of directives) {
        const range = matchTextDirective(document_, directive);
        if (range) return range;
    }
    return null;
};
