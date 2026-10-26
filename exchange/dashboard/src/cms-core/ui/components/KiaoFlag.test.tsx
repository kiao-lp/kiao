import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { KiaoFlag } from './KiaoFlag';

/**
 * A flag has to be drawn on every machine, which is why it is an SVG and not the Unicode regional
 * indicators Windows has no glyph for. So what is asserted here is that something was *drawn* — a
 * titled `<svg>` — and, for a full locale, that it is the country's flag rather than the language's.
 */
const drawn = (lang: string) => {
    const { container } = render(<KiaoFlag lang={lang} />);
    return container.querySelector('svg')?.querySelector('title')?.textContent ?? container.textContent;
};

describe('KiaoFlag', () => {
    it('draws a flag for a bare language code', () => {
        expect(drawn('fr')).toBe('France');
        expect(drawn('DE')).toBe('Germany');
        expect(drawn('zh')).toBe('China');
    });

    it('flies the Union Jack for English with no country of its own', () => {
        expect(drawn('en')).toBe('United Kingdom');
    });

    it('lets the country of a locale win over its language', () => {
        expect(drawn('en-US')).toBe('United States');
        expect(drawn('fr_FR')).toBe('France');
    });

    it('writes out a tag it knows no flag for', () => {
        expect(drawn('eo')).toBe('eo');
        expect(drawn('en-ZZ')).toBe('United Kingdom');
    });
});
