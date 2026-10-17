import { describe, it, expect } from 'vitest';

import { MINDMAP_COLORS } from '../model';
import { backgroundOptions, borderColorOptions, fontSizeOptions, fontSizeOptionsAround } from './note-style-options';

describe('backgroundOptions', () => {
    // No fill is offered first because it is what a note has until it is coloured, and it is a
    // value of its own — 'none', the canvas showing through — rather than the absence of one.
    it('should offer no fill at all, and then the ten colours in the order they are named', () => {
        expect(backgroundOptions.map((option) => option.value))
            .toEqual(['none', ...MINDMAP_COLORS]);
    });

    it('should name every fill it draws, there being nothing but a swatch to go by', () => {
        expect(backgroundOptions.every((option) => option.title.length > 0)).toBe(true);
    });
});

describe('borderColorOptions', () => {
    // As a relation's colour is: the colour every border is drawn in takes the property off the
    // note, which is why it is the empty value rather than a name of its own.
    it('should offer the colour every border is drawn in, as the empty value', () => {
        expect(borderColorOptions[0].value).toBe('');
        expect(borderColorOptions.map((option) => option.value))
            .toEqual(['', ...MINDMAP_COLORS]);
    });

    it('should name every colour it draws, there being nothing but a swatch to go by', () => {
        expect(borderColorOptions.every((option) => option.title.length > 0)).toBe(true);
    });
});

describe('fontSizeOptionsAround', () => {
    it('should offer the plain list for a size that is already on it', () => {
        expect(fontSizeOptionsAround(20)).toBe(fontSizeOptions);
    });

    it('should offer the size a note was stepped to, in its place among the others', () => {
        const around = fontSizeOptionsAround(22);
        expect(around.map((option) => option.value))
            .toEqual([10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 40]);
        expect(around.find((option) => option.value === 22)?.label).toBe('22');
    });

    it('should offer a size stepped past either end of the list', () => {
        expect(fontSizeOptionsAround(8).map((option) => option.value)[0]).toBe(8);
        expect(fontSizeOptionsAround(42).map((option) => option.value).at(-1)).toBe(42);
    });

    it('should leave the plain list untouched', () => {
        fontSizeOptionsAround(22);
        expect(fontSizeOptions).toHaveLength(10);
    });
});
