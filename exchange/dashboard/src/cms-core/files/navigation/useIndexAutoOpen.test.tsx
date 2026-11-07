import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileDto, parentPath } from 'src/cms-core/files/service';

const h = vi.hoisted(() => ({
    open: vi.fn(),
    browsing: { currentPath: '', currentFile: null as FileDto | null },
    files: [] as FileDto[],
}));

vi.mock('../core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => h.browsing,
}));
vi.mock('../core/CurrentFileList-ctx', () => ({
    useCurrentFileListContext: () => h.files,
}));
vi.mock('./NavigationModel', () => ({
    useNavigation: () => ({ open: h.open }),
}));

import { IndexAutoOpen, isIndexFile } from './useIndexAutoOpen';

const dir = (path: string): FileDto => ({ path, isDirectory: true, size: 0, lastModified: 0 });
const file = (path: string): FileDto => ({ path, isDirectory: false, size: 0, lastModified: 0 });

// Mimics FileBrowsingPersistence: the open path is the current file, the current path its folder.
const browseTo = (dto: FileDto) => {
    h.browsing = { currentFile: dto, currentPath: dto.isDirectory ? dto.path : parentPath(dto.path) };
};
// The store root, as worker reports it: path ".", browsed as "".
const browseToRoot = () => {
    h.browsing = { currentFile: dir('.'), currentPath: '' };
};
// Mimics CurrentFileList: a fresh array once the folder's own entries have arrived.
const listed = (...entries: FileDto[]) => { h.files = entries; };

describe('isIndexFile', () => {
    it.each<[string, boolean]>([
        ['docs/Index.md', true],
        ['docs/Index.mmap.json', true],
        ['docs/Index', true],
        ['docs/index.ts', false],
        ['docs/IndexCard.md', false],
        ['docs/My.Index.md', false],
    ])('%s -> %s', (path, expected) => expect(isIndexFile(file(path))).toBe(expected));

    it('ignores a folder named Index', () => expect(isIndexFile(dir('docs/Index'))).toBe(false));
});

describe('useIndexAutoOpen', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.browsing = { currentPath: '', currentFile: null };
        h.files = [];
    });

    it('opens the index of a folder entered from outside', () => {
        browseTo(dir('docs'));
        listed(file('docs/notes.md'), file('docs/Index.md'));

        render(<IndexAutoOpen />);

        expect(h.open).toHaveBeenCalledWith('docs/Index.md');
    });

    it('opens the first index file when the folder holds several', () => {
        browseTo(dir('docs'));
        listed(file('docs/Index.md'), file('docs/Index.mmap.json'));

        render(<IndexAutoOpen />);

        expect(h.open).toHaveBeenCalledWith('docs/Index.md');
    });

    it('leaves a folder without an index on its listing', () => {
        browseTo(dir('docs'));
        listed(file('docs/notes.md'));

        render(<IndexAutoOpen />);

        expect(h.open).not.toHaveBeenCalled();
    });

    it('waits for the listing to catch up with the folder', () => {
        browseTo(dir('docs'));
        listed(file('other/Index.md')); // still the previous folder's entries

        const { rerender } = render(<IndexAutoOpen />);
        expect(h.open).not.toHaveBeenCalled();

        listed(file('docs/Index.md'));
        rerender(<IndexAutoOpen />);

        expect(h.open).toHaveBeenCalledWith('docs/Index.md');
    });

    it('shows the listing when the index is closed', () => {
        browseTo(dir('docs'));
        listed(file('docs/Index.md'));
        const { rerender } = render(<IndexAutoOpen />);
        expect(h.open).toHaveBeenCalledTimes(1);

        browseTo(file('docs/Index.md')); // the auto-open landed
        rerender(<IndexAutoOpen />);
        browseTo(dir('docs')); // close button, back to the folder
        rerender(<IndexAutoOpen />);

        expect(h.open).toHaveBeenCalledTimes(1);
    });

    it('shows the listing when walking back up from a descendant', () => {
        browseTo(file('docs/guides/intro.md'));
        listed(file('docs/guides/intro.md'));
        const { rerender } = render(<IndexAutoOpen />);

        browseTo(dir('docs'));
        listed(file('docs/Index.md'), dir('docs/guides'));
        rerender(<IndexAutoOpen />);

        expect(h.open).not.toHaveBeenCalled();
    });

    it('opens the index again when the folder is re-entered from outside', () => {
        browseTo(dir('docs'));
        listed(file('docs/Index.md'), dir('docs/guides'));
        const { rerender } = render(<IndexAutoOpen />);
        expect(h.open).toHaveBeenCalledTimes(1);

        browseTo(dir('docs/guides')); // down into a subfolder…
        listed(file('docs/guides/intro.md'));
        rerender(<IndexAutoOpen />);
        browseTo(dir('docs')); // …and back up: the listing stays
        listed(file('docs/Index.md'), dir('docs/guides'));
        rerender(<IndexAutoOpen />);
        expect(h.open).toHaveBeenCalledTimes(1);

        browseToRoot(); // out to the root, then in again
        listed(dir('docs'));
        rerender(<IndexAutoOpen />);
        browseTo(dir('docs'));
        listed(file('docs/Index.md'), dir('docs/guides'));
        rerender(<IndexAutoOpen />);

        expect(h.open).toHaveBeenCalledTimes(2);
        expect(h.open).toHaveBeenLastCalledWith('docs/Index.md');
    });

    it('opens the root index on a fresh load', () => {
        browseToRoot();
        listed(file('Index.md'), dir('docs'));

        render(<IndexAutoOpen />);

        expect(h.open).toHaveBeenCalledWith('Index.md');
    });

    it('shows the root listing when its index is closed', () => {
        browseToRoot();
        listed(file('Index.md'), dir('docs'));
        const { rerender } = render(<IndexAutoOpen />);
        expect(h.open).toHaveBeenCalledTimes(1);

        browseTo(file('Index.md'));
        rerender(<IndexAutoOpen />);
        browseToRoot();
        rerender(<IndexAutoOpen />);

        expect(h.open).toHaveBeenCalledTimes(1);
    });

    it('decides once per visit, so a later refresh does not yank the browsing user', () => {
        browseTo(dir('docs'));
        listed(file('docs/notes.md'));
        const { rerender } = render(<IndexAutoOpen />);

        listed(file('docs/notes.md'), file('docs/Index.md')); // a file was renamed meanwhile
        rerender(<IndexAutoOpen />);

        expect(h.open).not.toHaveBeenCalled();
    });

    it('does nothing for a file', () => {
        browseTo(file('docs/notes.md'));
        listed(file('docs/notes.md'), file('docs/Index.md'));

        render(<IndexAutoOpen />);

        expect(h.open).not.toHaveBeenCalled();
    });
});
