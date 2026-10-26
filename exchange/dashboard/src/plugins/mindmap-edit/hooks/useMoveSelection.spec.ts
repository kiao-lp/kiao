import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MindmapElement, MindmapRelation, Note } from '../model';
import { useMoveSelection } from './useMoveSelection';

const mapElements = vi.fn();

// What is selected, and how far the map is zoomed, when a test starts.
const context = vi.hoisted(() => ({ selection: [] as string[], zoom: 1 }));

vi.mock('@cms-core', () => ({
    useSelectionContext: () => [context.selection, vi.fn()],
}));

vi.mock('../state', () => ({
    useMindmapStateContext: () => ({ mapElements, zoom: context.zoom }),
}));

const note = (id: string, x: number, y: number): Note => ({ id, userBounds: [x, y, null, null], content: id });

const relation = (id: string, from: string, to: string, bend?: [number, number]): MindmapRelation => ({
    id,
    ends: [{ id: `${id}-from`, target: from }, { id: `${id}-to`, target: to }],
    ...(bend && { bend })
});

/** These elements as the movement the hook asked for leaves them. */
const afterMove = (elements: MindmapElement[]): MindmapElement[] => elements.map(mapElements.mock.calls[0][0]);

describe('useMoveSelection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        context.selection = [];
        context.zoom = 1;
    });

    it('moves a selected note, and leaves the others where they are', () => {
        context.selection = ['NOTE-a'];
        const { result } = renderHook(() => useMoveSelection());

        act(() => result.current([10, 20]));

        const [moved, still] = afterMove([note('NOTE-a', 100, 100), note('NOTE-b', 100, 100)]) as Note[];
        expect(moved.userBounds).toEqual([110, 120, null, null]);
        expect(still.userBounds).toEqual([100, 100, null, null]);
    });

    // A relation has no position of its own: what moves is the bend holding its centre off the
    // middle of its line, and it moves on from the bend the relation already carried.
    it('bends a selected relation by the movement', () => {
        context.selection = ['REL-1', 'REL-2'];
        const { result } = renderHook(() => useMoveSelection());

        act(() => result.current([10, 20]));

        const bent = afterMove([
            relation('REL-1', 'NOTE-a', 'NOTE-b'),
            relation('REL-2', 'NOTE-a', 'NOTE-b', [5, 5])
        ]) as MindmapRelation[];
        expect(bent[0].bend).toEqual([10, 20]);
        expect(bent[1].bend).toEqual([15, 25]);
    });

    it('leaves a selected relation alone while a note of its own is moving', () => {
        context.selection = ['NOTE-a', 'REL-1'];
        const { result } = renderHook(() => useMoveSelection());

        act(() => result.current([10, 20]));

        const [carried] = afterMove([relation('REL-1', 'NOTE-a', 'NOTE-b')]) as MindmapRelation[];
        expect(carried.bend).toBeUndefined();
    });

    // The movement is in screen pixels and the map is drawn scaled, so what is dragged has to
    // follow the pointer rather than the zoom.
    it('divides the movement by the zoom', () => {
        context.selection = ['NOTE-a', 'REL-1'];
        context.zoom = 2;
        const { result } = renderHook(() => useMoveSelection());

        act(() => result.current([10, 20]));

        const [moved] = afterMove([note('NOTE-a', 100, 100)]) as Note[];
        expect(moved.userBounds).toEqual([105, 110, null, null]);
    });
});
