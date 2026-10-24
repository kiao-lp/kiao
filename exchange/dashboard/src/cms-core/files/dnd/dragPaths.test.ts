import { describe, expect, it } from 'vitest';
import {
    draggedPaths, draggedSelection, holdsDraggedFiles, markdownLinkOf, markdownLinksOf,
    readDraggedFiles, writeDraggedFiles,
} from './dragPaths';
import type { FileDto } from '../service';

/**
 * jsdom has no `DataTransfer`, so the one thing both ends of a drag actually use stands in for it:
 * a bag of types, written into and read back out of.
 */
const dataTransfer = (held: Record<string, string> = {}): DataTransfer => {
    const store = { ...held };
    return {
        get types() { return Object.keys(store); },
        setData: (type: string, value: string) => { store[type] = value; },
        getData: (type: string) => store[type] ?? '',
        effectAllowed: 'none',
    } as unknown as DataTransfer;
};

const entry = (path: string, isDirectory = false): FileDto =>
    ({ path, isDirectory, size: 0, lastModified: 0 });

describe('what a drag carries', () => {
    it('gives back what was put on it, folders still folders', () => {
        const data = dataTransfer();
        writeDraggedFiles(data, [
            { path: 'units/abc', isDirectory: true },
            { path: 'units/abc/cadre.md', isDirectory: false },
        ]);

        expect(readDraggedFiles(data)).toEqual([
            { path: 'units/abc', isDirectory: true },
            { path: 'units/abc/cadre.md', isDirectory: false },
        ]);
    });

    it('allows both effects, a drop being a move in one place and a copy in another', () => {
        const data = dataTransfer();
        writeDraggedFiles(data, [{ path: 'a.md', isDirectory: false }]);
        expect(data.effectAllowed).toBe('copyMove');
    });

    it('says the paths in plain text too, for whatever is outside this app', () => {
        const data = dataTransfer();
        writeDraggedFiles(data, [
            { path: 'a.md', isDirectory: false },
            { path: 'b.md', isDirectory: false },
        ]);
        expect(data.getData('text/plain')).toBe('a.md\nb.md');
    });

    it('answers nothing to a drag that is not the store’s, plain text and all', () => {
        const data = dataTransfer({ 'text/plain': 'a paragraph dragged out of a web page' });
        expect(readDraggedFiles(data)).toEqual([]);
        expect(draggedPaths(data)).toEqual([]);
        expect(holdsDraggedFiles(data)).toBe(false);
    });

    it('answers nothing to a drag whose payload is not a list of paths', () => {
        expect(readDraggedFiles(dataTransfer({ 'application/x-kiao-paths': '{oops' }))).toEqual([]);
        expect(readDraggedFiles(dataTransfer({ 'application/x-kiao-paths': '{"a":1}' }))).toEqual([]);
    });

    it('recognises its own drag without reading it, which is all dragover may do', () => {
        const data = dataTransfer();
        writeDraggedFiles(data, [{ path: 'a.md', isDirectory: false }]);
        expect(holdsDraggedFiles(data)).toBe(true);
        expect(holdsDraggedFiles(null)).toBe(false);
    });

    it('hands a mover the paths alone, a move being the same for both kinds', () => {
        const data = dataTransfer();
        writeDraggedFiles(data, [
            { path: 'units/abc', isDirectory: true },
            { path: 'a.md', isDirectory: false },
        ]);
        expect(draggedPaths(data)).toEqual(['units/abc', 'a.md']);
    });
});

describe('the selection a drag is started from', () => {
    it('reads each path’s kind off the listing it is shown in', () => {
        const listing = [entry('units', true), entry('a.md'), entry('b.md')];
        expect(draggedSelection(['units', 'b.md'], listing)).toEqual([
            { path: 'units', isDirectory: true },
            { path: 'b.md', isDirectory: false },
        ]);
    });

    it('calls a path the listing does not hold a file, there being nothing under it to move', () => {
        expect(draggedSelection(['gone.md'], [])).toEqual([{ path: 'gone.md', isDirectory: false }]);
    });
});

describe('a dropped file, written as a link', () => {
    it('is its name over its path from the store root', () => {
        expect(markdownLinkOf({ path: 'units/abc/cadre.md', isDirectory: false }))
            .toBe('[cadre.md](/units/abc/cadre.md)');
    });

    it('encodes what would otherwise end the destination early', () => {
        expect(markdownLinkOf({ path: 'mes notes/plan (v2).md', isDirectory: false }))
            .toBe('[plan (v2).md](/mes%20notes/plan%20%28v2%29.md)');
    });

    it('drops the brackets out of the name, one of them ending the text where it stands', () => {
        expect(markdownLinkOf({ path: 'a [draft].md', isDirectory: false }))
            .toBe('[a draft.md](/a%20%5Bdraft%5D.md)');
    });

    it('links a folder as it links a file — a folder of the store opens too', () => {
        expect(markdownLinkOf({ path: 'units/abc', isDirectory: true })).toBe('[abc](/units/abc)');
    });

    it('runs several along a sentence rather than down a list', () => {
        expect(markdownLinksOf([
            { path: 'a.md', isDirectory: false },
            { path: 'b.md', isDirectory: false },
        ])).toBe('[a.md](/a.md) [b.md](/b.md)');
    });
});
