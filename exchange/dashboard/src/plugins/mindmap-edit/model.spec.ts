import { describe, it, expect } from 'vitest';

import {
    DEFAULT_BODY_WIDTH, DEFAULT_NEW_NOTE_STYLE, DEFAULT_NEW_RELATION_STYLE, MindmapRelation,
    newNoteProperties, newRelationEndWidths, newRelationProperties, restyledRelation
} from './model';

describe('newNoteProperties', () => {
    it('should write nothing onto a note made in the style it would have had anyway', () => {
        expect(newNoteProperties(DEFAULT_NEW_NOTE_STYLE)).toEqual({});
    });

    it('should write every choice that departs from that style', () => {
        expect(newNoteProperties({
            fontSize: 32, shape: 'ellipse', edge: 'solid-4', borderColor: 'teal', background: 'green'
        })).toEqual({
            fontSize: 32, shape: 'ellipse', edge: 'solid-4', borderColor: 'teal', background: 'green'
        });
    });

    it('should leave out the properties left as they were', () => {
        expect(newNoteProperties({ ...DEFAULT_NEW_NOTE_STYLE, background: 'blue' }))
            .toEqual({ background: 'blue' });
    });

    // A border colour is the one departure with no name of its own for the colour every border is
    // drawn in: the empty choice writes nothing, as a relation's colour does.
    it('should write no border colour for the colour every border is drawn in', () => {
        expect(newNoteProperties({ ...DEFAULT_NEW_NOTE_STYLE, borderColor: '' })).toEqual({});
        expect(newNoteProperties({ ...DEFAULT_NEW_NOTE_STYLE, borderColor: 'brown' }))
            .toEqual({ borderColor: 'brown' });
    });
});

describe('newRelationEndWidths', () => {
    it('should give a relation made in the style it would have had anyway no width at all', () => {
        expect(newRelationEndWidths(DEFAULT_NEW_RELATION_STYLE)).toEqual([undefined, undefined]);
    });

    it('should give a rectangle the chosen width at both of its ends', () => {
        expect(newRelationEndWidths({ ...DEFAULT_NEW_RELATION_STYLE, body: 'rectangle', width: 32 }))
            .toEqual([32, 32]);
    });

    // Nought is the point, and the first end is the note the relation is made from — so the two
    // triangles are the one shape read either way round.
    it('should bring a triangle to a point at the note the relation is made from', () => {
        expect(newRelationEndWidths({ ...DEFAULT_NEW_RELATION_STYLE, body: 'triangle', width: 24 }))
            .toEqual([0, 24]);
    });

    it('should bring the reversed triangle to a point at the note it reaches', () => {
        expect(newRelationEndWidths({ ...DEFAULT_NEW_RELATION_STYLE, body: 'triangle-reversed', width: 24 }))
            .toEqual([24, 0]);
    });

    it('should start a body at the width one is first given', () => {
        expect(DEFAULT_NEW_RELATION_STYLE.width).toBe(DEFAULT_BODY_WIDTH);
    });
});

describe('newRelationProperties', () => {
    it('should write nothing onto a relation drawn in the colour every relation is drawn in', () => {
        expect(newRelationProperties(DEFAULT_NEW_RELATION_STYLE)).toEqual({});
    });

    it('should write the colour chosen', () => {
        expect(newRelationProperties({ ...DEFAULT_NEW_RELATION_STYLE, color: 'violet' }))
            .toEqual({ color: 'violet' });
    });
});

describe('restyledRelation', () => {
    /** A relation of two ends, each as wide as it is given. */
    const related = (...widths: (number | undefined)[]): MindmapRelation => ({
        id: 'REL-1',
        ends: [
            { id: 'END-a', target: 'NOTE-a', ...(widths[0] !== undefined && { width: widths[0] }) },
            { id: 'END-b', target: 'NOTE-b', ...(widths[1] !== undefined && { width: widths[1] }) }
        ]
    });

    const widthsOf = (relation: MindmapRelation) => relation.ends.map(end => end.width);

    it('should draw the relation in the body and the colour chosen', () => {
        const styled = restyledRelation(related(), { body: 'rectangle', width: 32, color: 'violet' });

        expect(widthsOf(styled)).toEqual([32, 32]);
        expect(styled.color).toBe('violet');
    });

    // The first end is the note the relation was made from, as it is on a relation being made:
    // the triangle in the bar and the triangle the brush draws point the same way.
    it('should bring a triangle to a point at the end a new relation would', () => {
        expect(widthsOf(restyledRelation(related(20, 20), { body: 'triangle', width: 36, color: '' })))
            .toEqual([0, 36]);
    });

    it('should write nothing at all for the look every relation has', () => {
        const styled = restyledRelation(
            { ...related(36, 36), color: 'red' }, DEFAULT_NEW_RELATION_STYLE);

        expect(styled.ends.every(end => !('width' in end))).toBe(true);
        expect('color' in styled).toBe(false);
    });

    it('should keep of an end everything but its width', () => {
        const decorated = related();
        decorated.ends[0] = { ...decorated.ends[0], decoration: 'FULL_TRIANGLE', attachPointNumber: 3 };

        expect(restyledRelation(decorated, { body: 'rectangle', width: 32, color: '' }).ends[0])
            .toEqual({ id: 'END-a', target: 'NOTE-a', decoration: 'FULL_TRIANGLE', attachPointNumber: 3, width: 32 });
    });

    it('should keep the bend the relation was drawn with', () => {
        const bent = { ...related(), bend: [10, 20] as [number, number] };

        expect(restyledRelation(bent, { body: 'rectangle', width: 32, color: '' }).bend).toEqual([10, 20]);
    });
});
