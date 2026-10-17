import { describe, it, expect, vi, beforeEach } from 'vitest';

const clipboard = vi.hoisted(() => ({ setClipboard: vi.fn().mockResolvedValue(undefined) }));
const message = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('../../lib/clipboard', () => clipboard);
vi.mock('antd', () => ({ message }));

import { buildFileBrowserContextMenu } from './fileBrowserContextMenu';
import { ContextMenuContext } from '../context-menu/ContextMenuRegistry';

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
});

const ctxOf = (paths: string[]): ContextMenuContext => ({
    paths,
    pointedPath: paths[0] ?? null,
    pointedFile: paths[0] ? { path: paths[0], isDirectory: false } : null,
    currentPath: '',
    isEmptyArea: false,
});

/**
 * "Copy relative path" copies the link form: from the store root, with the leading slash that
 * tells a reference apart from a document-relative one (`storeLinkOf`, kiao-worker/utils.ts). A
 * path copied here is pasted into a document, so without the slash it would read against the
 * document holding it instead of naming the file.
 */
describe('copy-relative-path', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('copies the path from the store root, with the leading slash', async () => {
        const item = buildFileBrowserContextMenu(deps()).find(i => i.id === 'copy-relative-path')!;
        await item.execute(ctxOf(['units/abc/cadre.md']));

        expect(clipboard.setClipboard).toHaveBeenCalledWith('/units/abc/cadre.md');
    });

    it('copies one link per line for a multi-selection', async () => {
        const item = buildFileBrowserContextMenu(deps()).find(i => i.id === 'copy-relative-path')!;
        await item.execute(ctxOf(['units/abc/cadre.md', 'docs/note.md']));

        expect(clipboard.setClipboard).toHaveBeenCalledWith('/units/abc/cadre.md\n/docs/note.md');
    });

    it('leaves a path already written as a link as it stands', async () => {
        const item = buildFileBrowserContextMenu(deps()).find(i => i.id === 'copy-relative-path')!;
        await item.execute(ctxOf(['/units/abc/cadre.md']));

        expect(clipboard.setClipboard).toHaveBeenCalledWith('/units/abc/cadre.md');
    });
});
