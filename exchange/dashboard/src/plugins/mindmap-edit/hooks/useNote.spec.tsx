import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DEFAULT_NEW_NOTE_STYLE } from '../model';
import { useApplyStyleToSelection, useCreateNote } from './useNote';

const addElement = vi.fn();
const mapElements = vi.fn();

// The style the map is set to when a test starts, and what is selected on it; the mocked state
// and selection read them, the tests set them.
const context = vi.hoisted(() => ({ newNoteStyle: {} as any, selection: [] as string[] }));

vi.mock('@cms-core', () => ({
    useSelectionContext: () => [context.selection, vi.fn()],
    Clipboard: {},
    useWorkerClient: () => ({}),
    toStoredLink: (link: string) => link,
    useFileBrowsingPersistenceContext: () => ({ currentFile: null, currentPath: '' }),
}));

vi.mock('../lib/link-note', () => ({
    findFavicon: vi.fn(),
    linkNoteContent: vi.fn(),
}));

vi.mock('./useRelation', () => ({
    useRelateNotes: () => vi.fn(),
}));

vi.mock('../state', () => ({
    useMindmapStateContext: () => ({
        mindmap: { elements: { notes: [], relations: [] } },
        addElement,
        mapElements,
        patchElement: vi.fn(),
        saveMindmap: vi.fn(),
        pointedLocation: [0, 0],
        newNoteStyle: context.newNoteStyle,
    }),
    useMindmapMode: () => [ 'EDIT', vi.fn() ],
}));

const noteMade = () => addElement.mock.calls[0][1];

describe('useCreateNote', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        context.newNoteStyle = DEFAULT_NEW_NOTE_STYLE;
        context.selection = [];
    });

    it('should make a note in the style the map is set to', () => {
        context.newNoteStyle = {
            fontSize: 32, shape: 'ellipse', edge: 'solid-4', borderColor: 'teal', background: 'green'
        };

        const { result } = renderHook(() => useCreateNote());
        act(() => result.current(undefined, [10, 20]));

        expect(noteMade()).toMatchObject({
            fontSize: 32, shape: 'ellipse', edge: 'solid-4', borderColor: 'teal', background: 'green'
        });
    });

    it('should leave a note made in the untouched style saying nothing of its look', () => {
        const { result } = renderHook(() => useCreateNote());
        act(() => result.current(undefined, [10, 20]));

        const note = noteMade();
        expect(note).not.toHaveProperty('fontSize');
        expect(note).not.toHaveProperty('shape');
        expect(note).not.toHaveProperty('edge');
        expect(note).not.toHaveProperty('borderColor');
        expect(note).not.toHaveProperty('background');
    });
});

/** The map the restyling is run over: two notes, one relation, only one of the notes selected. */
const elements = {
    selectedNote: {
        id: 'NOTE-1', userBounds: [0, 0, null, null], content: 'one',
        fontSize: 12, shape: 'ellipse', borderColor: 'brown'
    },
    otherNote: { id: 'NOTE-2', userBounds: [0, 0, null, null], content: 'two', background: 'red' },
    relation: { id: 'REL-1', ends: [{ target: 'NOTE-1' }, { target: 'NOTE-2' }] }
};

/** What the map holds once the hook's mapping function has been run over every element. */
const restyled = () => {
    const map = mapElements.mock.calls[0][0];
    return Object.fromEntries(Object.entries(elements).map(([name, element]) => [name, map(element)]));
};

describe('useApplyStyleToSelection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        context.newNoteStyle = DEFAULT_NEW_NOTE_STYLE;
        context.selection = ['NOTE-1', 'REL-1'];
    });

    it('should put every selected note into the style the map is set to', () => {
        context.newNoteStyle = {
            fontSize: 32, shape: 'diamond', edge: 'dotted', borderColor: 'pink', background: 'blue'
        };

        const { result } = renderHook(() => useApplyStyleToSelection());
        act(() => result.current());

        expect(restyled().selectedNote).toMatchObject({
            id: 'NOTE-1', content: 'one',
            fontSize: 32, shape: 'diamond', edge: 'dotted', borderColor: 'pink', background: 'blue'
        });
    });

    it('should leave a note restyled to the untouched look saying nothing of it', () => {
        const { result } = renderHook(() => useApplyStyleToSelection());
        act(() => result.current());

        const note = restyled().selectedNote;
        expect(note).not.toHaveProperty('fontSize');
        expect(note).not.toHaveProperty('shape');
        expect(note).not.toHaveProperty('edge');
        // The note came in brown-bordered: the untouched look takes the property off rather than
        // writing the colour every border is drawn in.
        expect(note).not.toHaveProperty('borderColor');
        expect(note).not.toHaveProperty('background');
    });

    it('should leave what is not a selected note alone', () => {
        context.newNoteStyle = {
            fontSize: 32, shape: 'diamond', edge: 'dotted', borderColor: 'pink', background: 'blue'
        };

        const { result } = renderHook(() => useApplyStyleToSelection());
        act(() => result.current());

        const { otherNote, relation } = restyled();
        expect(otherNote).toEqual(elements.otherNote);
        expect(relation).toEqual(elements.relation);
    });

    it('should do nothing with an empty selection', () => {
        context.selection = [];

        const { result } = renderHook(() => useApplyStyleToSelection());
        act(() => result.current());

        expect(mapElements).not.toHaveBeenCalled();
    });
});
