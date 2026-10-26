import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFileDrop } from './useFileDrop';
import { DraggedFile, writeDraggedFiles } from './dragPaths';

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

/** A drag out of the file tree carrying `paths`, folders named by `folders`. */
const dragOf = (paths: string[], folders: string[] = []): DataTransfer => {
    const data = dataTransfer();
    writeDraggedFiles(data, paths.map(path => ({ path, isDirectory: folders.includes(path) })));
    return data;
};

/** A box filled by a drop, inside a panel that would take the drop itself if it were let through. */
const Box: React.FC<{ onFile: (file: DraggedFile) => void; onPanelDrop?: () => void }> = ({
    onFile, onPanelDrop,
}) => {
    const { dropping, dropProps } = useFileDrop(onFile);
    return (
        <div onDrop={onPanelDrop}>
            <input aria-label="folder" data-dropping={dropping} readOnly {...dropProps} />
        </div>
    );
};

const box = () => screen.getByLabelText('folder');

describe('a box filled by dropping a file of the store on it', () => {
    it('is handed the entry that was dropped', () => {
        const onFile = vi.fn();
        render(<Box onFile={onFile} />);

        fireEvent.drop(box(), { dataTransfer: dragOf(['units/abc/cadre.md']) });

        expect(onFile).toHaveBeenCalledWith({ path: 'units/abc/cadre.md', isDirectory: false });
    });

    // The box holding one path is what makes the first entry the answer: there is nowhere else to
    // put the rest of a selection dropped on it.
    it('takes the first entry of a drag carrying several', () => {
        const onFile = vi.fn();
        render(<Box onFile={onFile} />);

        fireEvent.drop(box(), { dataTransfer: dragOf(['a.md', 'b.md', 'c.md']) });

        expect(onFile).toHaveBeenCalledTimes(1);
        expect(onFile).toHaveBeenCalledWith({ path: 'a.md', isDirectory: false });
    });

    // The folder box means one thing by a file and another by a folder, so the kind travels too.
    it('says whether what was dropped is a folder', () => {
        const onFile = vi.fn();
        render(<Box onFile={onFile} />);

        fireEvent.drop(box(), { dataTransfer: dragOf(['units/abc'], ['units/abc']) });

        expect(onFile).toHaveBeenCalledWith({ path: 'units/abc', isDirectory: true });
    });

    it('marks itself while a drag of ours is over it, and stops when it leaves', () => {
        render(<Box onFile={vi.fn()} />);
        const data = dragOf(['a.md']);

        fireEvent.dragOver(box(), { dataTransfer: data });
        expect(box()).toHaveAttribute('data-dropping', 'true');
        // The drop is a copy: the file stays where it is.
        expect(data.dropEffect).toBe('copy');

        fireEvent.dragLeave(box());
        expect(box()).toHaveAttribute('data-dropping', 'false');
    });

    it('is no longer marked once the drop has landed', () => {
        render(<Box onFile={vi.fn()} />);

        fireEvent.dragOver(box(), { dataTransfer: dragOf(['a.md']) });
        fireEvent.drop(box(), { dataTransfer: dragOf(['a.md']) });

        expect(box()).toHaveAttribute('data-dropping', 'false');
    });

    // A path copied out of a terminal is dropped in a text box the way it always has been, which
    // is only true of a box that never claimed the drop.
    it('leaves a drag that is not the store’s own to the browser', () => {
        const onFile = vi.fn();
        render(<Box onFile={onFile} />);
        const text = dataTransfer({ 'text/plain': '/home/alex/notes.md' });

        fireEvent.dragOver(box(), { dataTransfer: text });
        expect(box()).toHaveAttribute('data-dropping', 'false');
        expect(text.dropEffect).toBe('none');

        fireEvent.drop(box(), { dataTransfer: text });
        expect(onFile).not.toHaveBeenCalled();
    });

    // What is around the box may be taking dropped files as attachments, and this drop is not one.
    it('keeps a drop it took from going any further up', () => {
        const onPanelDrop = vi.fn();
        render(<Box onFile={vi.fn()} onPanelDrop={onPanelDrop} />);

        fireEvent.drop(box(), { dataTransfer: dragOf(['a.md']) });
        expect(onPanelDrop).not.toHaveBeenCalled();

        fireEvent.drop(box(), { dataTransfer: dataTransfer({ 'text/plain': 'x' }) });
        expect(onPanelDrop).toHaveBeenCalled();
    });
});
