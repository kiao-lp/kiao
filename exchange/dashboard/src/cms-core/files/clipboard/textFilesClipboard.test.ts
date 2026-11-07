import { describe, it, expect, vi } from 'vitest';
import { WorkerClient } from '../service';
import { parseTextFiles, pasteTextFiles, readTextFiles, serializeTextFiles } from './textFilesClipboard';

const files = [
    { name: 'ébauche.arch.md', content: '\ufeff# Texte\r\n\r\n« Bonjour » 🙂\n```json\n{}\n```\n' },
    { name: 'empty.json', content: '' },
];

describe('portable text files', () => {
    it('round-trips names and contents without changing whitespace, BOM, Unicode or empty files', () => {
        expect(parseTextFiles(serializeTextFiles(files))).toEqual(files);
    });

    it('rejects unrelated text, unsupported versions and malformed entries as a whole', () => {
        for (const value of [
            'plain text', 'null', '[]', '{}',
            JSON.stringify({ kind: 'kiao-text-files', version: 2, files }),
            JSON.stringify({ kind: 'kiao-text-files', version: 1, files: [] }),
            JSON.stringify({ kind: 'kiao-text-files', version: 1, files: [...files, { name: 'a.txt', content: 42 }] }),
        ]) expect(parseTextFiles(value)).toBeNull();
    });

    it('rejects paths and control characters in names and binary content', () => {
        for (const name of ['', ' ', '.', '..', '/a.txt', '../a.txt', 'a/b.txt', 'a\\b.txt', 'a\0.txt', 'a\n.txt']) {
            expect(parseTextFiles(JSON.stringify({ kind: 'kiao-text-files', version: 1, files: [{ name, content: '' }] }))).toBeNull();
        }
        expect(() => serializeTextFiles([{ name: 'a.txt', content: 'a\0b' }])).toThrow();
    });

    it('reads the selected files and preserves their basenames and UTF-8 bytes', async () => {
        const client = {
            getFileMetadata: vi.fn().mockResolvedValue({ isDirectory: false }),
            getFileBlob: vi.fn().mockImplementation(async (path: string) => ({
                arrayBuffer: async () => new TextEncoder().encode(path.endsWith('.md') ? files[0].content : '').buffer,
            })),
        };
        expect(await readTextFiles(client as unknown as WorkerClient, ['source/ébauche.arch.md', 'other/empty.json'])).toEqual(files);
    });

    it('refuses directories and invalid UTF-8 instead of copying damaged text', async () => {
        const client = {
            getFileMetadata: vi.fn().mockResolvedValue({ isDirectory: true }),
            getFileBlob: vi.fn().mockResolvedValue({ arrayBuffer: async () => new Uint8Array([0xff, 0xfe]).buffer }),
        };
        await expect(readTextFiles(client as unknown as WorkerClient, ['folder.md'])).rejects.toThrow();
        expect(client.getFileBlob).not.toHaveBeenCalled();
        client.getFileMetadata.mockResolvedValue({ isDirectory: false });
        await expect(readTextFiles(client as unknown as WorkerClient, ['binary.txt'])).rejects.toThrow();
    });
});

describe('pasting portable text files', () => {
    const clientOf = () => ({
        listFiles: vi.fn().mockResolvedValue([{ path: 'target/ébauche.arch.md' }]),
        createStaging: vi.fn().mockResolvedValue({ path: '.staging/clipboard' }),
        upload: vi.fn().mockResolvedValue(undefined),
        copyBatch: vi.fn().mockImplementation(async ({ items }) => items),
        discardStaging: vi.fn().mockResolvedValue(undefined),
    });

    it('preserves compound suffixes and stages duplicate names apart before a collision-safe batch copy', async () => {
        const client = clientOf();
        const count = await pasteTextFiles(client as unknown as WorkerClient, [...files, files[0]], 'target', ['.arch.md', '.md', '.json']);
        expect(count).toBe(3);
        expect(client.copyBatch).toHaveBeenCalledWith({ items: [
            { from: '.staging/clipboard/0/ébauche.arch.md', to: 'target/ébauche 1.arch.md' },
            { from: '.staging/clipboard/1/empty.json', to: 'target/empty.json' },
            { from: '.staging/clipboard/2/ébauche.arch.md', to: 'target/ébauche 2.arch.md' },
        ] });
        expect(client.upload).toHaveBeenNthCalledWith(1, '.staging/clipboard/0', files[0].content, { filename: files[0].name });
        expect(client.discardStaging).toHaveBeenCalledWith('.staging/clipboard');
    });

    it('pastes into the store root', async () => {
        const client = clientOf();
        client.listFiles.mockResolvedValue([]);
        await pasteTextFiles(client as unknown as WorkerClient, files, '', []);
        expect(client.copyBatch).toHaveBeenCalledWith({ items: [
            { from: '.staging/clipboard/0/ébauche.arch.md', to: 'ébauche.arch.md' },
            { from: '.staging/clipboard/1/empty.json', to: 'empty.json' },
        ] });
    });

    it('discards staging when upload or the batch fails and never retries a partial batch', async () => {
        for (const operation of ['upload', 'copyBatch'] as const) {
            const client = clientOf();
            client[operation].mockRejectedValueOnce(new Error('failed'));
            await expect(pasteTextFiles(client as unknown as WorkerClient, files, 'target', [])).rejects.toThrow('failed');
            expect(client.discardStaging).toHaveBeenCalledOnce();
            expect(client.copyBatch.mock.calls.length).toBe(operation === 'upload' ? 0 : 1);
        }
    });

    it('rejects incompatible entries before touching the store', async () => {
        const client = clientOf();
        await expect(pasteTextFiles(client as unknown as WorkerClient, [{ name: '../a.txt', content: '' }], 'target', [])).rejects.toThrow();
        expect(client.listFiles).not.toHaveBeenCalled();
    });
});
