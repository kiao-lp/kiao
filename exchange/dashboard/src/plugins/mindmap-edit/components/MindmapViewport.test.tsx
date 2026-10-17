import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MindmapViewportCmp } from './MindmapViewport';

// Mock mocks
const mockCreateNote = vi.fn();
const mockSetPointedLocation = vi.fn();
const mockEndSelection = vi.fn();
const mockDropOnMap = vi.fn();
const mockCancelRelationDrag = vi.fn();
const mockElementUp = vi.fn();

// What the mindmap is doing when a test starts: the mocked modules read it, the tests set it.
const context = vi.hoisted(() => ({
    mode: 'EDIT',
    pointedElement: null as string | null,
    relationPulledFrom: null as string | null,
}));

// Mock dependencies
vi.mock('@cms-core', () => ({
    useFileBrowsingPersistenceContext: () => ({ currentFile: 'test-file' }),
    useSelectionContext: () => [[], vi.fn()],
    useCommandDispatcherContext: () => ({ setEnabled: vi.fn() }),
}));

vi.mock('react-advanced-interactions', () => ({
    usePointedLocationTracker: () => [{ current: null }, vi.fn(), [100, 200]],
    withPointedLocationTracker: (C: any) => C,
    usePointedElementContext: () => [context.pointedElement, vi.fn()],
}));

vi.mock('../state', () => ({
    useMindmapStateContext: () => ({
        mindmap: { elements: { notes: [], relations: [] } },
        setPointedLocation: mockSetPointedLocation,
        zoom: 1,
        setZoom: vi.fn(),
    }),
    useMindmapMode: () => [context.mode, vi.fn()],
}));

vi.mock('./MindmapDragAndDrop', () => ({
    useMindmapDragAndDropContext: () => ({ onMindmapMove: vi.fn(), onElementUp: mockElementUp }),
}));

vi.mock('../hooks/useBoxSelection', () => ({
    useBoxSelection: () => ({
        isActive: false,
        startSelection: vi.fn(),
        updateSelection: vi.fn(),
        endSelection: mockEndSelection,
    }),
}));

vi.mock('./RelationDrag-ctx', () => ({
    useRelationDragContext: () => ({
        from: context.relationPulledFrom,
        pullFrom: vi.fn(),
        dropOnNote: vi.fn(),
        dropOnMap: mockDropOnMap,
        cancel: mockCancelRelationDrag,
    }),
}));

vi.mock('./RelationDraft-cmp', () => ({
    RelationDraftCmp: ({ from, to }: any) => <div data-testid="relation-draft">{from} {String(to)}</div>,
}));

vi.mock('../hooks/useMouseOverViewport', () => ({
    useMouseOverViewport: () => ({
        isMouseOverViewport: false,
        onMouseEnter: vi.fn(),
        onMouseLeave: vi.fn(),
    }),
}));

vi.mock('../hooks/useWheelZoom', () => ({
    useWheelZoom: vi.fn(),
}));

vi.mock('../hooks/useKeyboardZoom', () => ({
    useKeyboardZoom: vi.fn(),
}));

vi.mock('./Note', () => ({
    NoteCmp: () => <div>Note</div>,
}));

vi.mock('./MindmapRelation', () => ({
    MindmapRelationCmp: () => <div>Relation</div>,
}));

// Mock the hook we want to test interaction with
vi.mock('../hooks/useNote', () => ({
    useCreateNote: () => mockCreateNote,
}));

describe('MindmapViewportCmp Long Touch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        context.mode = 'EDIT';
        context.pointedElement = null;
        context.relationPulledFrom = null;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should create a new note on long press', () => {
        const { container } = render(<MindmapViewportCmp />);
        const mindmap = container.querySelector('.mindmap');

        expect(mindmap).toBeInTheDocument();

        // Simulate touch start
        fireEvent.touchStart(mindmap!, {
            touches: [{ clientX: 100, clientY: 100 }]
        });

        // Fast forward time by 600ms (assuming long press is ~500ms)
        act(() => {
            vi.advanceTimersByTime(600);
        });

        // Check if createNote was called
        expect(mockCreateNote).toHaveBeenCalled();

        // Check if pointed location was updated before createNote
        // Note: The mock `usePointedLocationTracker` returns [100, 200], 
        // but in a real scenario we'd update it from the event.
        // For now, checking logic execution is enough.
    });

    it('should cancel long press on move', () => {
        const { container } = render(<MindmapViewportCmp />);
        const mindmap = container.querySelector('.mindmap');

        // Simulate touch start
        fireEvent.touchStart(mindmap!, {
            touches: [{ clientX: 100, clientY: 100 }]
        });

        // Advance a bit
        act(() => {
            vi.advanceTimersByTime(200);
        });

        // Move significantly
        fireEvent.touchMove(mindmap!, {
            touches: [{ clientX: 150, clientY: 150 }]
        });

        // Advance past threshold
        act(() => {
            vi.advanceTimersByTime(400);
        });

        expect(mockCreateNote).not.toHaveBeenCalled();
    });

    it('should cancel long press on touch end', () => {
        const { container } = render(<MindmapViewportCmp />);
        const mindmap = container.querySelector('.mindmap');

        // Simulate touch start
        fireEvent.touchStart(mindmap!, {
            touches: [{ clientX: 100, clientY: 100 }]
        });

        // Advance a bit
        act(() => {
            vi.advanceTimersByTime(200);
        });

        // End touch
        fireEvent.touchEnd(mindmap!, {
            touches: []
        });

        // Advance past threshold
        act(() => {
            vi.advanceTimersByTime(400);
        });

        expect(mockCreateNote).not.toHaveBeenCalled();
    });
});

describe('MindmapViewportCmp Double Click', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        context.mode = 'EDIT';
        context.pointedElement = null;
        context.relationPulledFrom = null;
    });

    const doubleClick = (mindmap: Element, clientX: number, clientY: number) => {
        fireEvent.mouseDown(mindmap, { clientX, clientY, detail: 1 });
        fireEvent.mouseUp(mindmap, { clientX, clientY, detail: 1 });
        fireEvent.mouseDown(mindmap, { clientX, clientY, detail: 2 });
        fireEvent.mouseUp(mindmap, { clientX, clientY, detail: 2 });
        fireEvent.doubleClick(mindmap, { clientX, clientY, detail: 2 });
    };

    it('should create a note on the double clicked point', () => {
        const { container } = render(<MindmapViewportCmp />);

        doubleClick(container.querySelector('.mindmap')!, 120, 80);

        expect(mockCreateNote).toHaveBeenCalledWith(undefined, [120, 80]);
    });

    it('should leave a double click over an element to that element', () => {
        context.pointedElement = 'NOTE-somewhere';
        const { container } = render(<MindmapViewportCmp />);

        doubleClick(container.querySelector('.mindmap')!, 120, 80);

        expect(mockCreateNote).not.toHaveBeenCalled();
    });

    it('should not create a note when the double click is what starts the edition', () => {
        context.mode = 'VISUALIZE';
        const { container } = render(<MindmapViewportCmp />);

        doubleClick(container.querySelector('.mindmap')!, 120, 80);

        expect(mockCreateNote).not.toHaveBeenCalled();
    });
});

describe('MindmapViewportCmp Relation Drag', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        context.mode = 'EDIT';
        context.pointedElement = null;
        context.relationPulledFrom = 'NOTE-A';
    });

    const mindmapOf = () => render(<MindmapViewportCmp />).container.querySelector('.mindmap')!;

    it('should draw the pulled relation as it follows the pointer', () => {
        const mindmap = mindmapOf();

        expect(mindmap.querySelector('[data-testid="relation-draft"]')).not.toBeInTheDocument();

        fireEvent.mouseMove(mindmap, { clientX: 120, clientY: 80 });

        expect(mindmap.querySelector('[data-testid="relation-draft"]')).toHaveTextContent('NOTE-A 120,80');
    });

    it('should leave the pulled relation where it is let go on the bare map', () => {
        fireEvent.mouseUp(mindmapOf(), { clientX: 120, clientY: 80 });

        expect(mockDropOnMap).toHaveBeenCalledWith([120, 80]);
        expect(mockEndSelection).not.toHaveBeenCalled();
    });

    it('should give the pulled relation up when the pointer leaves the map', () => {
        fireEvent.mouseLeave(mindmapOf());

        expect(mockCancelRelationDrag).toHaveBeenCalled();
    });

    it('should end a box selection as usual when no relation is being pulled', () => {
        context.relationPulledFrom = null;

        fireEvent.mouseUp(mindmapOf(), { clientX: 120, clientY: 80 });

        expect(mockDropOnMap).not.toHaveBeenCalled();
        expect(mockEndSelection).toHaveBeenCalled();
    });

    // What is dragged follows the pointer on a timer, so a quick drag is let go with the pointer
    // already off it and the map is what the button comes up over. The drag has to end there too.
    it('should end a drag let go over the bare map', () => {
        context.relationPulledFrom = null;

        fireEvent.mouseUp(mindmapOf(), { clientX: 120, clientY: 80 });

        expect(mockElementUp).toHaveBeenCalled();
    });

    it('should leave a drag alone while a relation is being pulled', () => {
        fireEvent.mouseUp(mindmapOf(), { clientX: 120, clientY: 80 });

        expect(mockElementUp).not.toHaveBeenCalled();
    });
});
