import { describe, it, expect } from 'vitest';

import {
    MINDMAP_COLORS, DEFAULT_NEW_NOTE_STYLE, DEFAULT_NEW_RELATION_STYLE, NewNoteStyle, NewRelationStyle
} from '../model';
import {
    NewColor, newColorOptions, noteStyleInColor, relationStyleInColor, sharedNewColor
} from './new-color';

/** The two styles the bar holds, put into one colour the way the selector puts them. */
const drawnIn = (color: NewColor): [NewNoteStyle, NewRelationStyle] => [
    { ...DEFAULT_NEW_NOTE_STYLE, ...noteStyleInColor(color) },
    { ...DEFAULT_NEW_RELATION_STYLE, ...relationStyleInColor(color) }
];

describe('sharedNewColor', () => {
    it('should be the plain look when none of the three is coloured', () => {
        expect(sharedNewColor(DEFAULT_NEW_NOTE_STYLE, DEFAULT_NEW_RELATION_STYLE)).toBe('');
    });

    // What the selector is for: one word said by the border, the fill and the relation at once.
    it('should be the colour the three are all set to', () => {
        for (const color of MINDMAP_COLORS) {
            expect(sharedNewColor(...drawnIn(color)), color).toBe(color);
        }
    });

    // The three selectors are still there, and one of them moved alone is what makes this state.
    it('should be nothing at all when the note and the relation differ', () => {
        const [note, relation] = drawnIn('red');
        expect(sharedNewColor(note, { ...relation, color: 'blue' })).toBeNull();
    });

    it('should be nothing at all when a note is filled and bordered differently', () => {
        const [note, relation] = drawnIn('red');
        expect(sharedNewColor({ ...note, background: 'blue' }, relation)).toBeNull();
    });

    // A note whose border is the colour every border is drawn in is not a note of no colour: two
    // of the three are red, and there is no one word for what is being drawn.
    it('should be nothing at all when only the border is left at the default', () => {
        const [note, relation] = drawnIn('red');
        expect(sharedNewColor({ ...note, borderColor: '' }, relation)).toBeNull();
    });

    it('should be nothing at all when only the fill is left at no fill', () => {
        const [note, relation] = drawnIn('red');
        expect(sharedNewColor({ ...note, background: 'none' }, relation)).toBeNull();
    });
});

describe('noteStyleInColor and relationStyleInColor', () => {
    it('should ink a note border and fill it in the same colour', () => {
        expect(noteStyleInColor('teal')).toEqual({ borderColor: 'teal', background: 'teal' });
    });

    // The plain look is no fill at all, which the note calls 'none' and the other two call empty.
    it('should put the plain look back as each of the three spells it', () => {
        expect(noteStyleInColor('')).toEqual({ borderColor: '', background: 'none' });
        expect(relationStyleInColor('')).toEqual({ color: '' });
    });

    it('should leave the rest of a style alone', () => {
        const [note, relation] = drawnIn('pink');
        expect(note.fontSize).toBe(DEFAULT_NEW_NOTE_STYLE.fontSize);
        expect(note.shape).toBe(DEFAULT_NEW_NOTE_STYLE.shape);
        expect(note.edge).toBe(DEFAULT_NEW_NOTE_STYLE.edge);
        expect(relation.body).toBe(DEFAULT_NEW_RELATION_STYLE.body);
        expect(relation.width).toBe(DEFAULT_NEW_RELATION_STYLE.width);
    });

    // Which is what keeps the selector showing what it was last told: every colour it offers is
    // read back as itself out of the styles it wrote.
    it('should be read back by the selector as the colour that was picked', () => {
        for (const option of newColorOptions) {
            const color = option.value as NewColor;
            expect(sharedNewColor(...drawnIn(color)), color).toBe(color);
        }
    });
});

describe('newColorOptions', () => {
    it('should offer the plain look, and then the ten colours in the order they are named', () => {
        expect(newColorOptions.map((option) => option.value)).toEqual(['', ...MINDMAP_COLORS]);
    });

    it('should name every colour it draws, there being nothing but a swatch to go by', () => {
        expect(newColorOptions.every((option) => option.title.length > 0)).toBe(true);
    });
});
