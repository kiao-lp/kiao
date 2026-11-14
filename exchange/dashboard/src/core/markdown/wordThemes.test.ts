import { describe, expect, it } from 'vitest';
import { NEUTRAL_WORD_THEME, resolveWordTheme, wordColor } from './wordThemes';

describe('wordColor', () => {
    it('reads six-digit hex in any case', () => {
        expect(wordColor('#174a7e')).toBe('174A7E');
        expect(wordColor('#F0F0F0')).toBe('F0F0F0');
    });

    it('expands three-digit hex', () => {
        expect(wordColor('#999')).toBe('999999');
    });

    it('reads the named colors the neutral palette relies on', () => {
        expect(wordColor('white')).toBe('FFFFFF');
        expect(wordColor('black')).toBe('000000');
    });

    it('rejects anything else', () => {
        expect(wordColor('#12')).toBeUndefined();
        expect(wordColor('#12345')).toBeUndefined();
        expect(wordColor('red')).toBeUndefined();
        expect(wordColor('var(--text)')).toBeUndefined();
        expect(wordColor(42)).toBeUndefined();
        expect(wordColor(undefined)).toBeUndefined();
    });
});

describe('resolveWordTheme', () => {
    it('keeps the neutral native style without a theme', () => {
        expect(resolveWordTheme(undefined)).toEqual(NEUTRAL_WORD_THEME);
        expect(resolveWordTheme(undefined).headings).toHaveLength(6);
    });

    it('overlays the palette entry by entry, keeping Word defaults where unset', () => {
        const resolved = resolveWordTheme({
            id: 'company',
            label: 'Company',
            variables: { '--heading-1': '#174a7e', '--heading-3': '#abc', '--link': 'white' },
        });
        expect(resolved.headings[0]).toBe('174A7E');
        expect(resolved.headings[1]).toBeUndefined();
        expect(resolved.headings[2]).toBe('AABBCC');
        expect(resolved.link).toBe('FFFFFF');
        expect(resolved.text).toBe(NEUTRAL_WORD_THEME.text);
        expect(resolved.quoteBar).toBe(NEUTRAL_WORD_THEME.quoteBar);
    });

    it('falls back per entry on unparsable values', () => {
        const resolved = resolveWordTheme({
            id: 'broken',
            label: 'Broken',
            variables: { '--text': 'red', '--quote-bar': '#xyz', '--accent-bg': '#0000ff' },
        });
        expect(resolved.text).toBe(NEUTRAL_WORD_THEME.text);
        expect(resolved.quoteBar).toBe(NEUTRAL_WORD_THEME.quoteBar);
        expect(resolved.tableHeader).toBe('0000FF');
    });
});
