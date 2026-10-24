import { describe, it, expect, vi, beforeEach } from 'vitest';

const clipboard = vi.hoisted(() => ({ setClipboard: vi.fn().mockResolvedValue(undefined) }));
const message = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('../../lib/clipboard', () => clipboard);
vi.mock('antd', () => ({ message }));

import { buildFileBrowserContextMenu } from './fileBrowserContextMenu';
import { ContextMenuContext, ContextMenuItemDescriptor } from '../context-menu/ContextMenuRegistry';
import { isReadableAsText } from '../service/textFiles';

const deps = (): any => ({
    nav: {},
    workerClient: {},
    clipboard: {},
    selection: {},
    startRename: vi.fn(),
    duplicateFiles: vi.fn(),
    requestDelete: vi.fn(),
    handleDownload: vi.fn(),
    handleReplace: vi.fn(),
    reindexFiles: vi.fn(),
    refreshFileList: vi.fn(),
    isTextFile: isReadableAsText,
    openSecondary: vi.fn(),
});

const ctxOf = (paths: string[]): ContextMenuContext => ({
    paths,
    pointedPath: paths[0] ?? null,
    pointedFile: paths[0] ? { path: paths[0], isDirectory: false } : null,
    currentPath: '',
    isEmptyArea: false,
});

/** The "Copy as..." submenu and one of its entries. */
const copyChild = (id: string): ContextMenuItemDescriptor => {
    const parent = buildFileBrowserContextMenu(deps()).find(i => i.id === 'copy-as')!;
    return parent.children!.find(child => child.id === id)!;
};

/**
 * "Copy relative path" copies the link form: from the store root, with the leading slash that
 * tells a reference apart from a document-relative one (`storeLinkOf`, kiao-worker/utils.ts). A
 * path copied here is pasted into a document, so without the slash it would read against the
 * document holding it instead of naming the file.
 */
describe('copy-as submenu', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('groups the copy formats under "Copy as...", leaving the plain Copy outside', () => {
        const items = buildFileBrowserContextMenu(deps());
        const parent = items.find(i => i.id === 'copy-as')!;

        expect(parent.label).toBe('Copy as...');
        expect(parent.children!.map(child => child.id)).toEqual([
            'copy-text-files',
            'copy-markdown-link',
            'copy-relative-path',
            'copy-absolute-path',
        ]);
        expect(items.find(i => i.id === 'copy')).toBeDefined();
    });

    it('copies the path from the store root, with the leading slash', async () => {
        await copyChild('copy-relative-path').execute!(ctxOf(['units/abc/cadre.md']));

        expect(clipboard.setClipboard).toHaveBeenCalledWith('/units/abc/cadre.md');
    });

    it('copies one link per line for a multi-selection', async () => {
        await copyChild('copy-relative-path').execute!(ctxOf(['units/abc/cadre.md', 'docs/note.md']));

        expect(clipboard.setClipboard).toHaveBeenCalledWith('/units/abc/cadre.md\n/docs/note.md');
    });

    it('leaves a path already written as a link as it stands', async () => {
        await copyChild('copy-relative-path').execute!(ctxOf(['/units/abc/cadre.md']));

        expect(clipboard.setClipboard).toHaveBeenCalledWith('/units/abc/cadre.md');
    });

    it('copies a markdown link of the file, name over its link', async () => {
        await copyChild('copy-markdown-link').execute!(ctxOf(['units/abc/cadre.md']));

        expect(clipboard.setClipboard).toHaveBeenCalledWith('[cadre.md](/units/abc/cadre.md)');
    });

    it('runs the links of a multi-selection along one line', async () => {
        await copyChild('copy-markdown-link').execute!(ctxOf(['units/abc/cadre.md', 'docs/note.md']));

        expect(clipboard.setClipboard)
            .toHaveBeenCalledWith('[cadre.md](/units/abc/cadre.md) [note.md](/docs/note.md)');
    });
});

describe('text files clipboard menu', () => {
    const item = (id: string, overrides: object = {}) =>
        buildFileBrowserContextMenu({ ...deps(), ...overrides }).find(entry => entry.id === id)!;

    it('offers contents for text, structured documents, code and configuration files', () => {
        const action = copyChild('copy-text-files');
        for (const paths of [
            ['note.md'], ['plan.arch.md', 'data.mmap.json', 'icon.svg'],
            ['index.ts', 'style.css', 'main.cpp'], ['.env', 'Dockerfile', '.kiao-files'],
        ]) expect(action.enabledWhen!(ctxOf(paths)), paths.join(', ')).toBe(true);
    });

    it('hides contents on directories, empty selections and selections containing binaries', () => {
        const action = copyChild('copy-text-files');
        for (const paths of [[], ['image.png'], ['note.md', 'manual.pdf'], ['note.md', 'folder']]) {
            expect(action.enabledWhen!(ctxOf(paths))).toBe(false);
        }
        const folder = { ...ctxOf(['folder.md']), pointedFile: { path: 'folder.md', isDirectory: true } };
        expect(action.enabledWhen!(folder)).toBe(false);
        const parent = item('copy-as', { isTextFile: (path: string) => path !== 'folder.md' && isReadableAsText(path) });
        expect(parent.children!.find(child => child.id === 'copy-text-files')!
            .enabledWhen!(ctxOf(['note.md', 'folder.md']))).toBe(false);
    });

    it('copies the complete selection', async () => {
        const copyTextFiles = vi.fn();
        const parent = item('copy-as', { clipboard: { copyTextFiles } });
        await parent.children!.find(child => child.id === 'copy-text-files')!.execute!(ctxOf(['a.md', 'b.json']));
        expect(copyTextFiles).toHaveBeenCalledWith(['a.md', 'b.json']);
    });

    it('offers paste only on folders with a compatible system clipboard, including the root', async () => {
        const pasteTextFiles = vi.fn();
        const action = item('paste-text-files-row', { clipboard: { hasTextFiles: true, pasteTextFiles } });
        expect(action.enabledWhen!(ctxOf(['file.md']))).toBe(false);
        for (const path of ['', 'destination']) {
            const ctx = { ...ctxOf([path]), pointedFile: { path, isDirectory: true } };
            expect(action.enabledWhen!(ctx)).toBe(true);
            expect(item('paste-text-files-row', { clipboard: { hasTextFiles: false } }).enabledWhen!(ctx)).toBe(false);
            await action.execute!(ctx);
            expect(pasteTextFiles).toHaveBeenLastCalledWith(path);
        }
    });

    it('opens a single file as secondary and offers nothing for folders', async () => {
        const openSecondary = vi.fn();
        const action = buildFileBrowserContextMenu({ ...deps(), openSecondary })
            .find(entry => entry.id === 'open-secondary')!;
        expect(action.label).toBe('Open secondary');
        expect(action.enabledWhen!(ctxOf(['notes/a.md']))).toBe(true);
        const folder = { ...ctxOf(['notes']), pointedFile: { path: 'notes', isDirectory: true } };
        expect(action.enabledWhen!(folder)).toBe(false);
        expect(action.enabledWhen!(ctxOf(['a.md', 'b.md']))).toBe(false);
        expect(action.enabledWhen!({ ...ctxOf([]), isEmptyArea: true })).toBe(false);
        await action.execute!(ctxOf(['notes/a.md']));
        expect(openSecondary).toHaveBeenCalledWith('notes/a.md');
    });

    it('pastes into the browsed folder from its empty area', async () => {
        const pasteTextFiles = vi.fn();
        const action = item('paste-text-files-empty', { clipboard: { hasTextFiles: true, pasteTextFiles } });
        const ctx = { ...ctxOf([]), currentPath: 'destination', isEmptyArea: true };
        expect(action.enabledWhen!(ctx)).toBe(true);
        await action.execute!(ctx);
        expect(pasteTextFiles).toHaveBeenCalledWith('destination');
    });
});
