import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    DEFAULT_BODY_WIDTH, DEFAULT_NEW_RELATION_STYLE, MindmapElement, MindmapRelation,
    NewRelationStyle, RelationBody
} from '../model';
import {
    useApplyRelationStyleToSelection, useFlipRelationBody, useRelateNotes, useShapeRelationBody,
    useStraightenRelation, useWidenRelation
} from './useRelation';

const addElements = vi.fn();
const mapElements = vi.fn();

// What the map is pointing at, what is selected, and the style it draws in when a test starts.
const context = vi.hoisted(() => ({
    selection: [] as string[],
    pointedElement: null as string | null,
    newRelationStyle: undefined as NewRelationStyle | undefined
}));

vi.mock('@cms-core', () => ({
    useSelectionContext: () => [context.selection, vi.fn()],
}));

vi.mock('react-advanced-interactions', () => ({
    usePointedElementContext: () => [context.pointedElement, vi.fn()],
}));

vi.mock('../state', () => ({
    useMindmapStateContext: () => ({
        addElements, saveMindmap: vi.fn(), mapElements, selectElements: () => [],
        newRelationStyle: context.newRelationStyle
    }),
}));

// Every test starts on a map that has not been told to draw its relations any other way.
beforeEach(() => { context.newRelationStyle = DEFAULT_NEW_RELATION_STYLE; });

/** The relations the call added, as pairs of targets — which is what the pairing is judged on. */
const pairsMade = (): string[][] =>
    (addElements.mock.calls[0]?.[0].relations ?? []).map((relation: MindmapRelation) => relation.ends.map(end => end.target));

/** The one relation the call added, which is what the tests about its style look at. */
const relationMade = (): MindmapRelation => addElements.mock.calls[0][0].relations[0];

describe('useRelateNotes', () => {
    beforeEach(() => vi.clearAllMocks());

    it('relates the hub to each of the others, one relation per pair', () => {
        const { result } = renderHook(() => useRelateNotes());

        act(() => result.current('NOTE-hub', ['NOTE-a', 'NOTE-b', 'NOTE-c']));

        expect(pairsMade()).toEqual([['NOTE-hub', 'NOTE-a'], ['NOTE-hub', 'NOTE-b'], ['NOTE-hub', 'NOTE-c']]);
    });

    it('gives every relation and every end its own id', () => {
        const { result } = renderHook(() => useRelateNotes());

        act(() => result.current('NOTE-hub', ['NOTE-a', 'NOTE-b']));

        const relations: MindmapRelation[] = addElements.mock.calls[0][0].relations;
        const ids = relations.flatMap(relation => [relation.id, ...relation.ends.map(end => end.id)]);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('writes nothing on a relation but its ends: a relation is a straight line', () => {
        const { result } = renderHook(() => useRelateNotes());

        act(() => result.current('NOTE-hub', ['NOTE-a']));

        expect(Object.keys(addElements.mock.calls[0][0].relations[0]).sort()).toEqual(['ends', 'id']);
    });

    it('does nothing for a note related to itself, or to nothing at all', () => {
        const { result } = renderHook(() => useRelateNotes());

        act(() => result.current('NOTE-hub', ['NOTE-hub']));
        act(() => result.current('NOTE-hub', []));

        expect(addElements).not.toHaveBeenCalled();
    });

    it('relates a note named twice only once', () => {
        const { result } = renderHook(() => useRelateNotes());

        act(() => result.current('NOTE-hub', ['NOTE-a', 'NOTE-a']));

        expect(pairsMade()).toEqual([['NOTE-hub', 'NOTE-a']]);
    });

    // The map's style, which is where a relation gets its body and its colour: the hub is the
    // note the relation is made from, so it is the first of the two ends the widths land on.
    it('draws a rectangle as wide at the note it is made from as at the one it reaches', () => {
        context.newRelationStyle = { body: 'rectangle', width: 32, color: '' };
        const { result } = renderHook(() => useRelateNotes());

        act(() => result.current('NOTE-hub', ['NOTE-a']));

        expect(relationMade().ends.map(end => end.width)).toEqual([32, 32]);
    });

    it('brings a triangle to a point at the note the relation is made from', () => {
        context.newRelationStyle = { body: 'triangle', width: DEFAULT_BODY_WIDTH, color: '' };
        const { result } = renderHook(() => useRelateNotes());

        act(() => result.current('NOTE-hub', ['NOTE-a']));

        expect(relationMade().ends.map(end => [end.target, end.width]))
            .toEqual([['NOTE-hub', 0], ['NOTE-a', DEFAULT_BODY_WIDTH]]);
    });

    it('brings the reversed triangle to a point at the note it reaches', () => {
        context.newRelationStyle = { body: 'triangle-reversed', width: DEFAULT_BODY_WIDTH, color: '' };
        const { result } = renderHook(() => useRelateNotes());

        act(() => result.current('NOTE-hub', ['NOTE-a']));

        expect(relationMade().ends.map(end => [end.target, end.width]))
            .toEqual([['NOTE-hub', DEFAULT_BODY_WIDTH], ['NOTE-a', 0]]);
    });

    it('draws the relation in the colour the map is set to', () => {
        context.newRelationStyle = { ...DEFAULT_NEW_RELATION_STYLE, color: 'violet' };
        const { result } = renderHook(() => useRelateNotes());

        act(() => result.current('NOTE-hub', ['NOTE-a']));

        expect(relationMade().color).toBe('violet');
    });
});

/** A relation of two ends, each as wide as it is given. */
const related = (id: string, ...widths: (number | undefined)[]): MindmapRelation => ({
    id,
    ends: [
        { id: `${id}-a`, target: 'NOTE-a', ...(widths[0] !== undefined && { width: widths[0] }) },
        { id: `${id}-b`, target: 'NOTE-b', ...(widths[1] !== undefined && { width: widths[1] }) }
    ]
});

/** What the last call did to that relation. */
const mapped = (relation: MindmapRelation): MindmapRelation =>
    mapElements.mock.lastCall![0](relation) as MindmapRelation;

const widthsOf = (relation: MindmapRelation) => relation.ends.map(end => end.width);

describe('useApplyRelationStyleToSelection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        context.selection = [];
        context.pointedElement = null;
    });

    /** What the brush did to that element, the map's style being the one the test set. */
    const brushed = <T,>(element: T): T => {
        const { result } = renderHook(() => useApplyRelationStyleToSelection());
        act(() => result.current());
        return mapElements.mock.lastCall![0](element) as T;
    };

    it('draws a selected relation in the body and colour the map is set to', () => {
        context.selection = ['REL-1'];
        context.newRelationStyle = { body: 'rectangle', width: 32, color: 'violet' };

        const styled = brushed(related('REL-1'));

        expect(widthsOf(styled)).toEqual([32, 32]);
        expect(styled.color).toBe('violet');
    });

    it('leaves alone what is not selected, and the notes that are', () => {
        context.selection = ['REL-1', 'NOTE-a'];
        context.newRelationStyle = { body: 'rectangle', width: 32, color: 'violet' };

        const { result } = renderHook(() => useApplyRelationStyleToSelection());
        act(() => result.current());
        const brush = mapElements.mock.lastCall![0];

        expect(widthsOf(brush(related('REL-2')) as MindmapRelation)).toEqual([undefined, undefined]);
        const note = { id: 'NOTE-a', content: 'Note A', userBounds: [0, 0, null, null] };
        expect(brush(note as unknown as MindmapElement)).toBe(note);
    });

    it('does nothing at all when nothing is selected', () => {
        context.newRelationStyle = { body: 'rectangle', width: 32, color: '' };

        const { result } = renderHook(() => useApplyRelationStyleToSelection());
        act(() => result.current());

        expect(mapElements).not.toHaveBeenCalled();
    });
});

describe('useStraightenRelation', () => {
    beforeEach(() => vi.clearAllMocks());

    // Taken off rather than set to nothing: a relation straightened again is one never bent.
    it('takes the bend off the relation named, and only that one', () => {
        const { result } = renderHook(() => useStraightenRelation());

        act(() => result.current('REL-1'));

        const straighten = mapElements.mock.calls[0][0];
        const bent = (id: string): MindmapElement => ({
            id, bend: [10, 10], ends: [{ id: 'END-a', target: 'NOTE-a' }, { id: 'END-b', target: 'NOTE-b' }]
        } as MindmapRelation);

        expect(Object.keys(straighten(bent('REL-1')))).toEqual(['id', 'ends']);
        expect((straighten(bent('REL-2')) as MindmapRelation).bend).toEqual([10, 10]);
    });
});

describe('useShapeRelationBody', () => {
    beforeEach(() => vi.clearAllMocks());

    const shapeInto = (body: RelationBody, relation: MindmapRelation, endId = 'REL-1-a') => {
        const { result } = renderHook(() => useShapeRelationBody());
        act(() => result.current(endId, body));
        return mapped(relation);
    };

    it('gives a relation with no body a rectangle to start with', () => {
        expect(widthsOf(shapeInto('rectangle', related('REL-1'))))
            .toEqual([DEFAULT_BODY_WIDTH, DEFAULT_BODY_WIDTH]);
    });

    // Which end the triangle comes to a point at is the end the command was addressed to, the
    // pair being unordered; and it is the width the relation already had that it keeps.
    it('brings the end it is asked at to a point, and leaves the other the base', () => {
        expect(widthsOf(shapeInto('triangle', related('REL-1', 36, 36)))).toEqual([0, 36]);
        expect(widthsOf(shapeInto('triangle', related('REL-1', 36, 36), 'REL-1-b'))).toEqual([36, 0]);
    });

    it('takes the widths off again for the line, rather than writing the line\'s own weight', () => {
        const line = shapeInto('line', related('REL-1', 0, 36));

        expect(line.ends.every(end => !('width' in end))).toBe(true);
    });

    it('leaves the relations the end does not belong to alone', () => {
        const { result } = renderHook(() => useShapeRelationBody());
        act(() => result.current('REL-1-a', 'rectangle'));

        expect(widthsOf(mapped(related('REL-2')))).toEqual([undefined, undefined]);
    });
});

describe('useWidenRelation', () => {
    beforeEach(() => vi.clearAllMocks());

    const widen = (relation: MindmapRelation, by: number) => {
        const { result } = renderHook(() => useWidenRelation());
        act(() => result.current('REL-1-a', by));
        return widthsOf(mapped(relation));
    };

    it('widens every end at once, so the shape survives the resizing', () => {
        expect(widen(related('REL-1', 30, 30), 6)).toEqual([36, 36]);
    });

    it('leaves an end that comes to a point at its point', () => {
        expect(widen(related('REL-1', 0, 30), 6)).toEqual([0, 36]);
    });

    // The wheel over a plain line: it starts from the weight the line is drawn at.
    it('starts an end with no width of its own from the line\'s weight', () => {
        expect(widen(related('REL-1'), 6)).toEqual([14, 14]);
    });

    it('never narrows a body away to nothing', () => {
        expect(widen(related('REL-1', 6, 6), -20)).toEqual([2, 2]);
    });
});

describe('useFlipRelationBody', () => {
    beforeEach(() => vi.clearAllMocks());

    it('turns a triangle round by trading the widths of its two ends', () => {
        const { result } = renderHook(() => useFlipRelationBody());
        act(() => result.current('REL-1-a'));

        expect(widthsOf(mapped(related('REL-1', 0, 36)))).toEqual([36, 0]);
    });

    it('leaves a rectangle as it was, its two ends being equally wide', () => {
        const { result } = renderHook(() => useFlipRelationBody());
        act(() => result.current('REL-1-a'));

        expect(widthsOf(mapped(related('REL-1', 30, 30)))).toEqual([30, 30]);
    });
});
