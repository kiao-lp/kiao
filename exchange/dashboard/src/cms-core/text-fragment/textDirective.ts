/** Grammar: prefix-,start,end,-suffix; only start is required. start,end includes the text between.
 * Prefix and suffix provide disambiguating context; directives are joined by &.
 * Write #text= rather than #:~:text=: browsers strip :~: from location/history, and native
 * matching cannot handle client-rendered markdown or router navigation. Accept :~: in input strings.
 * Matching and selection live in matchTextDirective.ts and directiveForRange.ts. */

const FRAGMENT_DIRECTIVE = ':~:';

const TEXT_DIRECTIVE = 'text=';

export interface TextDirective {
    /** Context immediately before the passage. */
    prefix?: string;
    /** The passage, or its opening words when end is given. */
    start: string;
    /** Closing words of an inclusive range from start. */
    end?: string;
    /** Context immediately after the passage. */
    suffix?: string;
}

/** encodeURIComponent escapes comma and & separators. Also escape context-marker hyphens
 * and parentheses, which can terminate markdown destinations. */
const encodeTerm = (term: string): string =>
    encodeURIComponent(term).replace(/[()-]/g, character =>
        character === '(' ? '%28' : character === ')' ? '%29' : '%2D');

/** Preserve malformed escapes so a bad link can still open. */
const decodeTerm = (term: string): string => {
    try {
        return decodeURIComponent(term);
    } catch {
        return term;
    }
};

/** A lone term is passage text, even with a context-like hyphen.
 * Literal hyphens in terms are encoded; raw boundary hyphens mark context. */
const parseTextDirective = (value: string): TextDirective | null => {
    const terms = value.split(',');
    let prefix: string | undefined;
    let suffix: string | undefined;

    if (terms.length > 1 && terms[0].endsWith('-')) prefix = decodeTerm(terms.shift()!.slice(0, -1));
    if (terms.length > 1 && terms[terms.length - 1].startsWith('-')) suffix = decodeTerm(terms.pop()!.slice(1));
    if (terms.length < 1 || terms.length > 2) return null;

    const start = decodeTerm(terms[0]);
    if (!start) return null;
    const end = terms.length === 2 ? decodeTerm(terms[1]) : undefined;
    if (end === '') return null;

    return { ...(prefix ? { prefix } : {}), start, ...(end ? { end } : {}), ...(suffix ? { suffix } : {}) };
};

/** Accept an optional # and either plain text= directives or directives following :~:. */
export const parseTextFragment = (hash: string): TextDirective[] => {
    const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
    const at = fragment.indexOf(FRAGMENT_DIRECTIVE);
    return (at < 0 ? fragment : fragment.slice(at + FRAGMENT_DIRECTIVE.length))
        .split('&')
        .filter(part => part.startsWith(TEXT_DIRECTIVE))
        .map(part => parseTextDirective(part.slice(TEXT_DIRECTIVE.length)))
        .filter((directive): directive is TextDirective => directive !== null);
};

const writeTextDirective = (directive: TextDirective): string => [
    directive.prefix !== undefined ? `${encodeTerm(directive.prefix)}-` : null,
    encodeTerm(directive.start),
    directive.end !== undefined ? encodeTerm(directive.end) : null,
    directive.suffix !== undefined ? `-${encodeTerm(directive.suffix)}` : null,
].filter(term => term !== null).join(',');

/** Write #text=, never the browser-reserved :~: delimiter. */
export const textFragmentOf = (directives: TextDirective[]): string =>
    directives.length === 0
        ? ''
        : `#${directives.map(d => `${TEXT_DIRECTIVE}${writeTextDirective(d)}`).join('&')}`;

export const linkToPassage = (link: string, directives: TextDirective[]): string =>
    `${link.split('#')[0]}${textFragmentOf(directives)}`;
