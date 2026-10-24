import React from 'react';
import { message } from 'antd';
import {
    FolderOpenOutlined,
    ExportOutlined,
    ScissorOutlined,
    CopyOutlined,
    SnippetsOutlined,
    EditOutlined,
    BlockOutlined,
    DeleteOutlined,
    DownloadOutlined,
    SwapOutlined,
    ReloadOutlined,
    SelectOutlined,
    FileSearchOutlined,
    FileOutlined,
} from '@ant-design/icons';
import { isIndexable } from 'kiao-worker';
import { storeLinkOf } from 'kiao-worker/utils';
import { setClipboard } from '../../lib/clipboard';
import { WorkerClient, getStoreRoot, absoluteStorePath } from '../service';
import { markdownLinksOf } from '../dnd/dragPaths';
import { ContextMenuItemDescriptor } from '../context-menu/ContextMenuRegistry';
import { useFileSelection } from '../selection/SelectionModel-ctx';
import { useClipboard } from '../clipboard/ClipboardModel-ctx';
import { useNavigation } from '../navigation/NavigationModel';

export interface FileBrowserContextMenuDeps {
    nav: ReturnType<typeof useNavigation>;
    workerClient: WorkerClient;
    clipboard: ReturnType<typeof useClipboard>;
    selection: ReturnType<typeof useFileSelection>;
    startRename: (path: string) => void;
    duplicateFiles: (paths: string[]) => void;
    requestDelete: (paths: string[]) => void;
    handleDownload: (path: string) => void;
    handleReplace: (path: string) => void;
    reindexFiles: (paths: string[]) => void;
    refreshFileList: () => void;
    isTextFile: (path: string) => boolean;
    openSecondary?: (path: string) => void;
}

/** Right-click menu for the file browser: open, clipboard, duplicate/rename/delete, download/replace, meta. */
export const buildFileBrowserContextMenu = ({
    nav, clipboard, selection, workerClient, startRename, duplicateFiles, requestDelete, handleDownload, handleReplace,
    reindexFiles, refreshFileList, isTextFile, openSecondary,
}: FileBrowserContextMenuDeps): ContextMenuItemDescriptor[] => [
    {
        id: 'open',
        label: 'Open',
        icon: <FolderOpenOutlined />,
        group: '1-open',
        order: 10,
        enabledWhen: (ctx) => !ctx.isEmptyArea && ctx.paths.length === 1,
        execute: (ctx) => { if (ctx.paths[0]) nav.open(ctx.paths[0]); },
    },
    {
        id: 'open-new-tab',
        label: 'Open in new tab',
        icon: <ExportOutlined />,
        group: '1-open',
        order: 20,
        enabledWhen: (ctx) => !ctx.isEmptyArea && ctx.paths.length === 1,
        execute: (ctx) => { if (ctx.paths[0]) nav.openInNewTab(ctx.paths[0]); },
    },
    {
        id: 'open-new-window',
        label: 'Open in new window',
        icon: <ExportOutlined />,
        group: '1-open',
        order: 30,
        enabledWhen: (ctx) => !ctx.isEmptyArea && ctx.paths.length === 1,
        execute: (ctx) => { if (ctx.paths[0]) nav.openInNewWindow(ctx.paths[0]); },
    },
    {
        id: 'open-secondary',
        label: 'Open secondary',
        icon: <FileOutlined />,
        group: '1-open',
        order: 40,
        enabledWhen: (ctx) => !!openSecondary && !ctx.isEmptyArea && ctx.paths.length === 1
            && !!ctx.pointedFile && !ctx.pointedFile.isDirectory,
        execute: (ctx) => { if (ctx.paths[0]) openSecondary?.(ctx.paths[0]); },
    },
    {
        id: 'cut',
        label: 'Cut',
        icon: <ScissorOutlined />,
        group: '2-clipboard',
        order: 10,
        enabledWhen: (ctx) => !ctx.isEmptyArea && ctx.paths.length > 0,
        execute: (ctx) => clipboard.cut(ctx.paths),
    },
    {
        id: 'copy',
        label: 'Copy',
        icon: <CopyOutlined />,
        group: '2-clipboard',
        order: 20,
        enabledWhen: (ctx) => !ctx.isEmptyArea && ctx.paths.length > 0,
        execute: (ctx) => clipboard.copy(ctx.paths),
    },
    {
        id: 'paste-row',
        label: 'Paste into folder',
        icon: <SnippetsOutlined />,
        group: '2-clipboard',
        order: 30,
        enabledWhen: (ctx) =>
            !ctx.isEmptyArea && clipboard.hasEntries() && !!ctx.pointedFile?.isDirectory,
        execute: async (ctx) => {
            if (ctx.pointedFile?.isDirectory) await clipboard.paste(ctx.pointedFile.path);
        },
    },
    {
        id: 'paste-text-files-row',
        label: 'Paste text files',
        icon: <SnippetsOutlined />,
        group: '2-clipboard',
        order: 35,
        enabledWhen: ctx => !ctx.isEmptyArea && !!ctx.pointedFile?.isDirectory && clipboard.hasTextFiles,
        execute: async ctx => {
            if (ctx.pointedFile?.isDirectory) await clipboard.pasteTextFiles(ctx.pointedFile.path);
        },
    },
    {
        id: 'copy-as',
        label: 'Copy as...',
        icon: <CopyOutlined />,
        group: '2-clipboard',
        order: 40,
        // The store root has no path of its own to copy.
        enabledWhen: (ctx) => !ctx.isEmptyArea && ctx.paths.some(Boolean),
        children: [
            {
                id: 'copy-text-files',
                label: 'Copy text files with contents',
                order: 40,
                enabledWhen: ctx => !ctx.isEmptyArea && !ctx.pointedFile?.isDirectory
                    && ctx.paths.length > 0 && ctx.paths.every(isTextFile),
                execute: async ctx => { await clipboard.copyTextFiles(ctx.paths); },
            },
            {
                id: 'copy-markdown-link',
                label: 'Copy markdown link',
                order: 10,
                enabledWhen: (ctx) => !ctx.isEmptyArea && ctx.paths.some(Boolean),
                execute: async (ctx) => {
                    const files = ctx.paths.filter(Boolean).map(path => ({ path, isDirectory: false }));
                    await setClipboard(markdownLinksOf(files));
                    message.success(files.length > 1 ? `${files.length} links copied!` : 'Link copied!');
                },
            },
            {
                id: 'copy-relative-path',
                label: 'Copy relative path',
                order: 20,
                enabledWhen: (ctx) => !ctx.isEmptyArea && ctx.paths.some(Boolean),
                execute: async (ctx) => {
                    // The link form — from the store root, with the leading slash. A path copied
                    // here is pasted into a document, where only that slash tells a reference apart
                    // from one read against the document holding it.
                    const paths = ctx.paths.filter(Boolean).map(storeLinkOf);
                    await setClipboard(paths.join('\n'));
                    message.success(paths.length > 1 ? `${paths.length} paths copied!` : 'Path copied!');
                },
            },
            {
                id: 'copy-absolute-path',
                label: 'Copy absolute path',
                order: 30,
                enabledWhen: (ctx) => !ctx.isEmptyArea && ctx.paths.some(Boolean),
                execute: async (ctx) => {
                    const paths = ctx.paths.filter(Boolean);
                    // Only the server knows where the store sits on its host, so the prefix is
                    // fetched (once per session) rather than derived from anything the browser holds.
                    try {
                        const root = await getStoreRoot(workerClient);
                        const absolute = paths.map(path => absoluteStorePath(root, path));
                        await setClipboard(absolute.join('\n'));
                        message.success(absolute.length > 1 ? `${absolute.length} paths copied!` : 'Path copied!');
                    } catch {
                        message.error('Could not read the store location.');
                    }
                },
            },
        ],
    },
    {
        id: 'paste-empty',
        label: 'Paste',
        icon: <SnippetsOutlined />,
        group: '0-paste',
        order: 10,
        enabledWhen: (ctx) => ctx.isEmptyArea && clipboard.hasEntries(),
        execute: async (ctx) => { await clipboard.paste(ctx.currentPath); },
    },
    {
        id: 'paste-text-files-empty',
        label: 'Paste text files',
        icon: <SnippetsOutlined />,
        group: '0-paste',
        order: 20,
        enabledWhen: ctx => ctx.isEmptyArea && clipboard.hasTextFiles,
        execute: async ctx => { await clipboard.pasteTextFiles(ctx.currentPath); },
    },
    {
        id: 'duplicate',
        label: 'Duplicate',
        icon: <BlockOutlined />,
        group: '3-edit',
        order: 5,
        // The store root has no name of its own to number.
        enabledWhen: (ctx) => !ctx.isEmptyArea && ctx.paths.some(Boolean),
        execute: (ctx) => { duplicateFiles(ctx.paths); },
    },
    {
        id: 'rename',
        label: 'Rename',
        icon: <EditOutlined />,
        group: '3-edit',
        order: 10,
        enabledWhen: (ctx) => !ctx.isEmptyArea && ctx.paths.length === 1,
        execute: (ctx) => { if (ctx.paths[0]) startRename(ctx.paths[0]); },
    },
    {
        id: 'delete',
        label: 'Delete',
        icon: <DeleteOutlined />,
        danger: true,
        group: '3-edit',
        order: 20,
        enabledWhen: (ctx) => !ctx.isEmptyArea && ctx.paths.length > 0,
        execute: (ctx) => { requestDelete(ctx.paths); },
    },
    {
        id: 'download',
        label: 'Download',
        icon: <DownloadOutlined />,
        group: '4-file',
        order: 10,
        enabledWhen: (ctx) => !ctx.isEmptyArea && ctx.paths.length === 1,
        execute: (ctx) => { if (ctx.paths[0]) handleDownload(ctx.paths[0]); },
    },
    {
        id: 'replace',
        label: 'Replace…',
        icon: <SwapOutlined />,
        group: '4-file',
        order: 20,
        enabledWhen: (ctx) => !ctx.isEmptyArea && ctx.paths.length === 1
            && !!ctx.pointedFile && !ctx.pointedFile.isDirectory,
        execute: (ctx) => { if (ctx.paths[0]) handleReplace(ctx.paths[0]); },
    },
    {
        id: 'reindex',
        label: 'Rebuild search index',
        icon: <FileSearchOutlined />,
        group: '4-file',
        order: 30,
        // Offered for the browsed folder on the empty area, and for the selection on a row: a
        // folder always qualifies, a file when the server can convert its type. Both are decided
        // from what the listing already carries, so the menu stays synchronous.
        enabledWhen: (ctx) => ctx.isEmptyArea
            || (ctx.paths.length > 0 && (!!ctx.pointedFile?.isDirectory || ctx.paths.some(isIndexable))),
        execute: (ctx) => { reindexFiles(ctx.isEmptyArea ? [ctx.currentPath] : ctx.paths); },
    },
    {
        id: 'refresh',
        label: 'Refresh',
        icon: <ReloadOutlined />,
        group: '5-meta',
        order: 10,
        enabledWhen: (ctx) => ctx.isEmptyArea,
        execute: () => { refreshFileList(); },
    },
    {
        id: 'select-all-ctx',
        label: 'Select all',
        icon: <SelectOutlined />,
        group: '5-meta',
        order: 20,
        enabledWhen: (ctx) => ctx.isEmptyArea,
        execute: () => { selection.selectAll(selection.getVisiblePaths()); },
    },
];
