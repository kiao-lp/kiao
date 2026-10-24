import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    AUTO_WIDTH_LIMIT, MindmapRectCmpEditable, MindmapRectCmpEdited, MindmapRectCmpInert
} from './MindmapRect';

/** What the map is showing as picked out, which the specs below set before they render. */
const picked = vi.hoisted(() => ({ selection: [] as string[] }));
const map = vi.hoisted(() => ({ patchElement: vi.fn(), saveMindmap: vi.fn(), zoom: 1 }));

vi.mock('@cms-core', () => ({
    useFileBrowsingPersistenceContext: () => ({ currentFile: 'test-file' }),
    useSelectionContext: () => [picked.selection, vi.fn()],
    Selectable: ({ children }: any) => children,
    useElementSelection: (id: string) => ({
        selected: picked.selection.includes(id),
        select: vi.fn(), addToSelection: vi.fn(), deselect: vi.fn()
    }),
}));

vi.mock('react-advanced-interactions', () => ({
    Pointable: ({ children }: any) => children,
}));

vi.mock('../state', () => ({
    useMindmapStateContext: () => ({
        patchElement: map.patchElement, saveMindmap: map.saveMindmap,
        selectElements: () => [], zoom: map.zoom
    }),
    useMindmapMode: () => ['EDIT', vi.fn()],
}));

vi.mock('./MindmapDragAndDrop', () => ({
    useMindmapDragAndDropContext: () => ({ onElementDown: vi.fn(), onElementUp: vi.fn() }),
}));

vi.mock('./RelationDrag-ctx', () => ({
    useRelationDragContext: () => ({ from: null, pullFrom: vi.fn(), dropOnNote: vi.fn() }),
}));

vi.mock('../hooks/useDroppedFiles', () => ({
    useNoteFileDrop: () => ({ dropping: false, dropProps: {} }),
}));

/**
 * jsdom knows no `PointerEvent`, and what it is replaced by instead carries no coordinates — so a
 * drag would arrive with nothing to read. `MouseEvent` carries exactly the two a resize is about.
 */
class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;

    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
    }
}

(window as any).PointerEvent = TestPointerEvent;

const rectOf = (container: HTMLElement) => container.querySelector('.mindmap-rect') as HTMLElement;

/** The last size this note was patched to, ignoring the measuring the editor does of its own. */
const lastUserBounds = () => [...map.patchElement.mock.calls]
    .reverse().find(call => 'userBounds' in call[2])?.[2].userBounds;

beforeEach(() => {
    picked.selection = [];
    map.zoom = 1;
    map.patchElement.mockClear();
    map.saveMindmap.mockClear();
});

describe('MindmapRect auto width', () => {
    it('limits the width of an auto-sized rect', () => {
        const { container } = render(
            <MindmapRectCmpInert id="NOTE-1" userBounds={[10, 20, null, null]}>text</MindmapRectCmpInert>
        );

        expect(rectOf(container).style.maxWidth).toBe(`${AUTO_WIDTH_LIMIT}px`);
        expect(rectOf(container).style.width).toBe('');
    });

    it('does not limit the width of a rect resized by the user', () => {
        const { container } = render(
            <MindmapRectCmpInert id="NOTE-1" userBounds={[10, 20, 900, null]}>text</MindmapRectCmpInert>
        );

        expect(rectOf(container).style.maxWidth).toBe('');
        expect(rectOf(container).style.width).toBe('900px');
    });

    it('never grows an edited rect beyond the limit, even from oversized measured bounds', () => {
        const { container } = render(
            <MindmapRectCmpEdited id="NOTE-1" userBounds={[10, 20, null, null]} bounds={[10, 20, 5000, 40]}>
                text
            </MindmapRectCmpEdited>
        );

        expect(rectOf(container).style.minWidth).toBe(`${AUTO_WIDTH_LIMIT}px`);
        expect(rectOf(container).style.maxWidth).toBe(`${AUTO_WIDTH_LIMIT}px`);
    });
});


/**
 * The handles along a note's four sides, and what dragging one does to it. They are the wheel's
 * alternative for a device that has none, so what they must agree on with the wheel is that the
 * note is resized about its middle — which is asserted here and in `note-resize.spec.ts`.
 */
describe('resizing a note by its edges', () => {
    const noteOf = (container: HTMLElement) =>
        container.querySelectorAll('.mindmap-note-resize');

    // jsdom measures every box at nothing, so the note is put at the origin: a client
    // coordinate is then the map coordinate the drag is read as.
    const renderNote = () => render(
        <MindmapRectCmpEditable id="NOTE-1" userBounds={[0, 0, 200, 80]} bounds={[0, 0, 200, 80]}>
            text
        </MindmapRectCmpEditable>
    );

    it('gives a note picked out on its own a handle along each of its sides', () => {
        picked.selection = ['NOTE-1'];
        const { container } = renderNote();

        expect([...noteOf(container)].map(handle => handle.getAttribute('data-resize-edge')))
            .toEqual(['left', 'right', 'top', 'bottom']);
    });

    it('offers none to a note that is not selected', () => {
        const { container } = renderNote();

        expect(noteOf(container)).toHaveLength(0);
    });

    // Several notes ringed at once are moved together, not resized: no one edge is the handle.
    it('offers none while other notes are selected with it', () => {
        picked.selection = ['NOTE-1', 'NOTE-2'];
        const { container } = renderNote();

        expect(noteOf(container)).toHaveLength(0);
    });

    it('widens the note about its middle when an edge is dragged, and saves on letting go', () => {
        picked.selection = ['NOTE-1'];
        const { container } = renderNote();
        const right = container.querySelector('[data-resize-edge="right"]')!;

        fireEvent.pointerDown(right, { pointerId: 1, clientX: 200, clientY: 40 });
        fireEvent.pointerMove(right, { pointerId: 1, buttons: 1, clientX: 150, clientY: 40 });

        // Middle at 100: the right side pulled back to 150 makes the note 100 wide about it.
        expect(lastUserBounds()).toEqual([50, 0, 100, 80]);

        map.saveMindmap.mockClear();
        fireEvent.pointerUp(right, { pointerId: 1, clientX: 150, clientY: 40 });
        expect(map.saveMindmap).toHaveBeenCalled();
    });

    it('leaves the note alone when a pointer merely crosses a handle', () => {
        picked.selection = ['NOTE-1'];
        const { container } = renderNote();

        fireEvent.pointerMove(container.querySelector('[data-resize-edge="top"]')!,
            { pointerId: 1, buttons: 1, clientX: 100, clientY: 0 });

        expect(lastUserBounds()).toBeUndefined();
    });

    // The map is drawn zoomed and the note's box with it, so a hand that moved 50 screen pixels
    // over a map at 2 has moved the note's edge by 25 of its own.
    it('reads the drag in the map\'s pixels and not the screen\'s', () => {
        picked.selection = ['NOTE-1'];
        map.zoom = 2;
        const { container } = renderNote();
        const right = container.querySelector('[data-resize-edge="right"]')!;

        fireEvent.pointerDown(right, { pointerId: 1, clientX: 400, clientY: 80 });
        fireEvent.pointerMove(right, { pointerId: 1, buttons: 1, clientX: 300, clientY: 80 });

        expect(lastUserBounds()).toEqual([50, 0, 100, 80]);
    });
});

/**
 * The wheel is the older way to resize, and it now agrees with the handles: the note grows or
 * shrinks about its middle rather than out of its top left corner.
 */
describe('resizing a note by the wheel', () => {
    it('keeps the note centred where it was as it grows', () => {
        const { container } = render(
            <MindmapRectCmpEditable id="NOTE-1" userBounds={[100, 100, 200, 80]} bounds={[100, 100, 200, 80]}>
                text
            </MindmapRectCmpEditable>
        );

        fireEvent.wheel(rectOf(container), { deltaY: -100 });

        expect(lastUserBounds()).toEqual([95, 100, 210, 80]);
        expect(map.saveMindmap).toHaveBeenCalled();
    });

    it('makes the note taller about its middle with shift held', () => {
        const { container } = render(
            <MindmapRectCmpEditable id="NOTE-1" userBounds={[100, 100, 200, 80]} bounds={[100, 100, 200, 80]}>
                text
            </MindmapRectCmpEditable>
        );

        fireEvent.wheel(rectOf(container), { deltaY: -100, shiftKey: true });

        expect(lastUserBounds()).toEqual([100, 95, 200, 90]);
    });
});
