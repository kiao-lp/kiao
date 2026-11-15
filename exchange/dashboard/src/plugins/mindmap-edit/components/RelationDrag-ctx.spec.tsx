import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { RelationDragProvider, useRelationDragContext, RelationDragValue } from './RelationDrag-ctx';

const mockRelateNotes = vi.fn();
const mockCreateNote = vi.fn();
const mockSaveMindmap = vi.fn();

vi.mock('../state', () => ({
    useMindmapStateContext: () => ({ saveMindmap: mockSaveMindmap }),
}));

vi.mock('../hooks/useRelation', () => ({
    useRelateNotes: () => mockRelateNotes,
}));

vi.mock('../hooks/useNote', () => ({
    useCreateNote: () => mockCreateNote,
}));

let drag!: RelationDragValue;

const Consumer: React.FC = () => {
    drag = useRelationDragContext();
    return null;
};

const renderDrag = () => render(<RelationDragProvider><Consumer /></RelationDragProvider>);

describe('a relation pulled out of a note', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        renderDrag();
    });

    const pullFrom = (noteId: string) => act(() => drag.pullFrom(noteId));

    it('relates the note it is let go on to the one it was pulled from', () => {
        pullFrom('NOTE-A');

        act(() => drag.dropOnNote('NOTE-B'));

        expect(mockRelateNotes).toHaveBeenCalledWith('NOTE-A', ['NOTE-B']);
        expect(mockSaveMindmap).toHaveBeenCalled();
        expect(drag.from).toBeNull();
    });

    it('leaves a new note where it is let go on the bare map, related to where it came from', () => {
        pullFrom('NOTE-A');

        act(() => drag.dropOnMap([120, 80]));

        expect(mockCreateNote).toHaveBeenCalledWith(undefined, [120, 80], ['NOTE-A']);
        expect(drag.from).toBeNull();
    });

    it('makes nothing of a relation let go on the note it came from', () => {
        pullFrom('NOTE-A');

        act(() => drag.dropOnNote('NOTE-A'));

        expect(mockRelateNotes).not.toHaveBeenCalled();
        expect(drag.from).toBeNull();
    });

    it('makes nothing of a drop when no relation is being pulled', () => {
        act(() => drag.dropOnNote('NOTE-B'));
        act(() => drag.dropOnMap([120, 80]));

        expect(mockRelateNotes).not.toHaveBeenCalled();
        expect(mockCreateNote).not.toHaveBeenCalled();
    });

    it('makes nothing of a relation given up on', () => {
        pullFrom('NOTE-A');

        act(() => drag.cancel());

        expect(drag.from).toBeNull();
        expect(mockRelateNotes).not.toHaveBeenCalled();
        expect(mockCreateNote).not.toHaveBeenCalled();
    });
});
