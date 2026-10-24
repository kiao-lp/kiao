import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useMapFileDrop, useNoteFileDrop } from './useDroppedFiles';

const createNote = vi.fn();
const patchElement = vi.fn();
const saveMindmap = vi.fn();

/** What the map is doing when a test starts: the mocked state reads it, the tests set it. */
const context = vi.hoisted(() => ({ mode: 'EDIT' as string, content: 'what it says' }));

// The two halves of the drag are the real ones: what the file tree writes and what this reads back
// is the whole of what the two ends have to agree on, and a mock of it would agree with nothing.
vi.mock('@cms-core', async () => {
    const dnd = await import('../../../cms-core/files/dnd/dragPaths');
    return {
        holdsDraggedFiles: dnd.holdsDraggedFiles,
        readDraggedFiles: dnd.readDraggedFiles,
        markdownLinksOf: dnd.markdownLinksOf,
    };
});

vi.mock('../state', () => ({
    useMindmapMode: () => [context.mode, vi.fn()],
    useMindmapStateContext: () => ({
        selectElements: (select: (element: any) => boolean) =>
            [{ id: 'NOTE-1', userBounds: [0, 0, null, null], content: context.content }].filter(select),
        patchElement,
        saveMindmap,
    }),
}));

vi.mock('./useNote', () => ({ useCreateNote: () => createNote }));

/** jsdom has no `DataTransfer`; what both ends of a drag use is a bag of types. See dragPaths.test. */
const dataTransfer = (held: Record<string, string> = {}): DataTransfer => {
    const store = { ...held };
    return {
        get types() { return Object.keys(store); },
        setData: (type: string, value: string) => { store[type] = value; },
        getData: (type: string) => store[type] ?? '',
        effectAllowed: 'none',
        dropEffect: 'none',
    } as unknown as DataTransfer;
};

/** A drag out of the file navigator carrying `paths`, folders named by `folders`. */
const dragOf = async (paths: string[], folders: string[] = []): Promise<DataTransfer> => {
    const { writeDraggedFiles } = await import('../../../cms-core/files/dnd/dragPaths');
    const data = dataTransfer();
    writeDraggedFiles(data, paths.map(path => ({ path, isDirectory: folders.includes(path) })));
    return data;
};

/**
 * The map with one note on it — the two drops nested as they are drawn, so that a drop the note
 * takes really does have to be stopped for the map not to take it as well.
 */
const Map: React.FC = () => {
    const mapDrop = useMapFileDrop(() => [140, 60]);
    const { dropping, dropProps } = useNoteFileDrop('NOTE-1');
    return (
        <div aria-label="map" {...mapDrop}>
            <div aria-label="note" data-dropping={dropping} {...dropProps} />
        </div>
    );
};

const map = () => screen.getByLabelText('map');
const note = () => screen.getByLabelText('note');

describe('a file dragged out of the file navigator and let go over a map', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        context.mode = 'EDIT';
        context.content = 'what it says';
        render(<Map />);
    });

    it('leaves a note holding a link to it where it was let go on the bare map', async () => {
        fireEvent.drop(map(), { dataTransfer: await dragOf(['units/abc/cadre.md']) });

        // Related to nothing: what was selected on the map is not what the file is about.
        expect(createNote).toHaveBeenCalledWith('[cadre.md](/units/abc/cadre.md)', [140, 60], []);
    });

    it('goes at the end of the note it was let go on', async () => {
        fireEvent.drop(note(), { dataTransfer: await dragOf(['units/abc/cadre.md']) });

        expect(patchElement).toHaveBeenCalledWith('notes', 'NOTE-1', {
            content: 'what it says\n\n[cadre.md](/units/abc/cadre.md)',
        });
        expect(saveMindmap).toHaveBeenCalled();
    });

    it('is not made a note of by the map as well when a note has taken it', async () => {
        fireEvent.drop(note(), { dataTransfer: await dragOf(['units/abc/cadre.md']) });

        expect(createNote).not.toHaveBeenCalled();
    });

    it('is the whole of what an empty note then says', async () => {
        context.content = '';
        fireEvent.drop(note(), { dataTransfer: await dragOf(['a.md']) });

        expect(patchElement).toHaveBeenCalledWith('notes', 'NOTE-1', { content: '[a.md](/a.md)' });
    });

    it('takes what a drag of several carries, all of it', async () => {
        fireEvent.drop(map(), { dataTransfer: await dragOf(['a.md', 'b/c.md']) });

        expect(createNote).toHaveBeenCalledWith('[a.md](/a.md) [c.md](/b/c.md)', [140, 60], []);
    });

    it('marks the note it is held over, and lets go of the mark when it moves off', async () => {
        const held = await dragOf(['a.md']);

        fireEvent.dragOver(note(), { dataTransfer: held });
        expect(note()).toHaveAttribute('data-dropping', 'true');

        fireEvent.dragLeave(note(), { dataTransfer: held });
        expect(note()).toHaveAttribute('data-dropping', 'false');
    });
});

describe('a drag that is not the store\'s own', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        context.mode = 'EDIT';
        render(<Map />);
    });

    it('leaves the map alone', () => {
        const text = dataTransfer({ 'text/plain': 'a paragraph out of a web page' });

        fireEvent.dragOver(map(), { dataTransfer: text });
        fireEvent.drop(map(), { dataTransfer: text });

        expect(createNote).not.toHaveBeenCalled();
    });

    it('leaves a note alone, and does not mark it', () => {
        const text = dataTransfer({ 'text/plain': 'a paragraph out of a web page' });

        fireEvent.dragOver(note(), { dataTransfer: text });
        expect(note()).toHaveAttribute('data-dropping', 'false');

        fireEvent.drop(note(), { dataTransfer: text });
        expect(patchElement).not.toHaveBeenCalled();
    });
});

// A map put into VISUALIZE is being read rather than written — and it is also what a map is in
// until it is first clicked, which is the state a double click declines to create a note in.
describe('a map being visualised', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        context.mode = 'VISUALIZE';
        render(<Map />);
    });

    it('takes no note from a file let go on it', async () => {
        fireEvent.drop(map(), { dataTransfer: await dragOf(['a.md']) });

        expect(createNote).not.toHaveBeenCalled();
    });

    it('takes no link into the note a file is let go on', async () => {
        fireEvent.drop(note(), { dataTransfer: await dragOf(['a.md']) });

        expect(patchElement).not.toHaveBeenCalled();
    });
});
