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

    it('should be the colour the three are all set to', () => {
        for (const color of MINDMAP_COLORS) {
            expect(sharedNewColor(...drawnIn(color)), color).toBe(color);
        }
    });

    it('should be nothing at all when the note and the relation differ', () => {
        const [note, relation] = drawnIn('red');
        expect(sharedNewColor(note, { ...relation, color: 'blue' })).toBeNull();
    });

    it('should be nothing at all when a note is filled and bordered differently', () => {
        const [note, relation] = drawnIn('red');
        expect(sharedNewColor({ ...note, background: 'blue' }, relation)).toBeNull();
    });

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
