import type { PdfTheme } from './pdfThemes';

/**
 * A store theme reused for the Word export. Only the palette translates to
 * native OOXML formatting; a theme's arbitrary `css` and `headerHtml` stay
 * PDF-only — CSS has no automatic OOXML translation (see decision 00069).
 *
 * Unset or unparsable entries fall back to the neutral native style, so an
 * export without a theme is byte-for-byte what it was before themes existed.
 */
export interface ResolvedWordTheme {
    /** Body text (`--text`). */
    text: string;
    /** Heading colors (`--heading-1` … `--heading-6`); undefined keeps Word's default. */
    headings: readonly (string | undefined)[];
    /** Link color (`--link`); undefined keeps the Hyperlink style. */
    link?: string;
    /** Quotation left border (`--quote-bar`). */
    quoteBar: string;
    /** Table header cell fill (`--accent-bg`). */
    tableHeader: string;
    /** Code paragraph fill (`--input-bg`). */
    codeFill: string;
    /** Horizontal rule color (`--hr-color`). */
    rule: string;
}

/** The neutral native style, as generated before themes existed. */
export const NEUTRAL_WORD_THEME: ResolvedWordTheme = {
    text: '1A1A1A',
    headings: [undefined, undefined, undefined, undefined, undefined, undefined],
    quoteBar: '999999',
    tableHeader: 'F0F0F0',
    codeFill: 'F5F5F5',
    rule: '999999',
};

const NAMED_COLORS: Record<string, string> = {
    black: '000000',
    white: 'FFFFFF',
};

/**
 * A theme palette entry as an OOXML hex color (`RRGGBB`), or undefined when
 * it is missing or not a supported notation. Supported: `#rgb`, `#rrggbb`,
 * `black` and `white` — the neutral palette and its copies are hex, and
 * `--bg` itself is the word `white`.
 */
export function wordColor(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim().toLowerCase();
    const named = NAMED_COLORS[trimmed];
    if (named) return named;
    const hex = trimmed.startsWith('#') ? trimmed.slice(1) : null;
    if (hex === null) return undefined;
    if (/^[0-9a-f]{3}$/.test(hex)) {
        return hex.split('').map(char => char + char).join('').toUpperCase();
    }
    if (/^[0-9a-f]{6}$/.test(hex)) return hex.toUpperCase();
    return undefined;
}

const HEADING_VARIABLES = ['--heading-1', '--heading-2', '--heading-3', '--heading-4', '--heading-5', '--heading-6'] as const;

/** Overlay a theme's palette on the neutral native style. */
export function resolveWordTheme(theme?: PdfTheme): ResolvedWordTheme {
    if (!theme) return NEUTRAL_WORD_THEME;
    const variables = theme.variables ?? {};
    return {
        text: wordColor(variables['--text']) ?? NEUTRAL_WORD_THEME.text,
        headings: HEADING_VARIABLES.map(key => wordColor(variables[key])),
        link: wordColor(variables['--link']),
        quoteBar: wordColor(variables['--quote-bar']) ?? NEUTRAL_WORD_THEME.quoteBar,
        tableHeader: wordColor(variables['--accent-bg']) ?? NEUTRAL_WORD_THEME.tableHeader,
        codeFill: wordColor(variables['--input-bg']) ?? NEUTRAL_WORD_THEME.codeFill,
        rule: wordColor(variables['--hr-color']) ?? NEUTRAL_WORD_THEME.rule,
    };
}
