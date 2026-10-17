import { describe, it, expect, vi } from 'vitest';
import { collectFromEntries, collectFromInput, joinPath, uploadTree, UploadTree } from './folderUpload';
import { WorkerClient } from '..';

/**
 * Minimal FileSystemEntry stand-ins. readEntries deliberately hands out its children in batches,
 * mirroring the real reader's ~100-entry cap and empty-batch terminator.
 */
const BATCH = 2;

const fileEntry = (name: string, contents = 'x'): FileSystemEntry => ({
    isFile: true,
    isDirectory: false,
    name,
    file: (cb: (f: File) => void) => cb(new File([contents], name)),
} as unknown as FileSystemEntry);

const dirEntry = (name: string, children: FileSystemEntry[]): FileSystemEntry => ({
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
        let cursor = 0;
        return {
            readEntries: (cb: (entries: FileSystemEntry[]) => void) => {
                const batch = children.slice(cursor, cursor + BATCH);
                cursor += batch.length;
                cb(batch);
            },
        };
    },
} as unknown as FileSystemEntry);

function makeClient() {
    const uploaded: string[] = [];
    const folders: string[] = [];
    const client = {
        upload: vi.fn(async (parent: string, file: File) => {
            uploaded.push(joinPath(parent, (file as File).name));
        }),
        createFolder: vi.fn(async (path: string) => {
            folders.push(path);
        }),
    } as unknown as WorkerClient;
    return { client, uploaded, folders };
}

const inputFile = (relativePath: string): File => {
    const file = new File(['x'], relativePath.split('/').pop()!);
    Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
    return file;
};

describe('joinPath', () => {
    it('drops empty segments and collapses separators', () => {
        expect(joinPath('docs', 'a/b')).toBe('docs/a/b');
        expect(joinPath('', 'a')).toBe('a');
        expect(joinPath('docs', '')).toBe('docs');
        expect(joinPath('docs/', '/a')).toBe('docs/a');
    });
});

describe('collectFromInput', () => {
    it('reads the directory of each file from webkitRelativePath', () => {
        const tree = collectFromInput([inputFile('myfolder/sub/a.md'), inputFile('myfolder/b.md')]);
        expect(tree.items.map(i => i.relativeDir)).toEqual(['myfolder/sub', 'myfolder']);
        expect(tree.emptyDirs).toEqual([]);
    });

    it('treats a plain selection without webkitRelativePath as flat', () => {
        const tree = collectFromInput([new File(['x'], 'a.md')]);
        expect(tree.items).toEqual([{ file: expect.anything(), relativeDir: '' }]);
    });
});

describe('collectFromEntries', () => {
    it('walks nested directories, keeping each file"s path', async () => {
        const tree = await collectFromEntries([
            dirEntry('myfolder', [
                fileEntry('a.md'),
                dirEntry('sub', [fileEntry('b.md')]),
            ]),
        ]);
        expect(tree.items.map(i => joinPath(i.relativeDir, i.file.name)))
            .toEqual(['myfolder/a.md', 'myfolder/sub/b.md']);
    });

    it('drains readEntries past one batch', async () => {
        const many = Array.from({ length: 7 }, (_, i) => fileEntry(`f${i}.md`));
        const tree = await collectFromEntries([dirEntry('big', many)]);
        expect(tree.items).toHaveLength(7);
    });

    it('records directories that hold no files, since no upload would recreate them', async () => {
        const tree = await collectFromEntries([dirEntry('myfolder', [dirEntry('empty', [])])]);
        expect(tree.items).toEqual([]);
        expect(tree.emptyDirs).toEqual(['myfolder/empty']);
    });

    it('keeps a dropped loose file at the target root', async () => {
        const tree = await collectFromEntries([fileEntry('a.md')]);
        expect(tree.items[0].relativeDir).toBe('');
    });
});

describe('uploadTree', () => {
    it('uploads each file into its directory under the target path', async () => {
        const { client, uploaded } = makeClient();
        const tree = await collectFromEntries([
            dirEntry('myfolder', [fileEntry('a.md'), dirEntry('sub', [fileEntry('b.md')])]),
        ]);

        const outcome = await uploadTree(client, 'docs', tree);

        expect(uploaded.sort()).toEqual(['docs/myfolder/a.md', 'docs/myfolder/sub/b.md']);
        expect(outcome).toEqual({ succeeded: 2, failed: [] });
    });

    it('creates empty directories explicitly', async () => {
        const { client, folders } = makeClient();
        const tree: UploadTree = { items: [], emptyDirs: ['myfolder/empty'] };

        await uploadTree(client, 'docs', tree);

        expect(folders).toEqual(['docs/myfolder/empty']);
    });

    it('uploads to the root when the target path is empty', async () => {
        const { client, uploaded } = makeClient();
        const tree = await collectFromEntries([dirEntry('myfolder', [fileEntry('a.md')])]);

        await uploadTree(client, '', tree);

        expect(uploaded).toEqual(['myfolder/a.md']);
    });

    it('reports failures per file and still uploads the rest', async () => {
        const { client, uploaded } = makeClient();
        vi.mocked(client.upload).mockImplementationOnce(async () => { throw new Error('boom'); });
        const tree = await collectFromEntries([dirEntry('myfolder', [fileEntry('a.md'), fileEntry('b.md')])]);

        const outcome = await uploadTree(client, 'docs', tree);

        expect(outcome.succeeded).toBe(1);
        expect(outcome.failed).toHaveLength(1);
        expect(uploaded).toHaveLength(1);
    });

    it('counts progress once per file, up to the total', async () => {
        const { client } = makeClient();
        const many = Array.from({ length: 9 }, (_, i) => fileEntry(`f${i}.md`));
        const tree = await collectFromEntries([dirEntry('big', many)]);
        const seen: number[] = [];

        await uploadTree(client, 'docs', tree, (done, total) => {
            expect(total).toBe(9);
            seen.push(done);
        });

        expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
});
