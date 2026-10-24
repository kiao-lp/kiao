import React from 'react';
import { HotkeyDescriptor, CommandContext } from '../../commands/HotkeyRegistry';
import { FileDto } from '../service';
import { useFileSelection } from '../selection/SelectionModel-ctx';
import { useClipboard } from '../clipboard/ClipboardModel-ctx';
import { useNavigation } from '../navigation/NavigationModel';

const isFilePath = (str: string) => str.includes('/');

const isFolderView = (ctx: CommandContext): boolean => {
    const file = ctx.currentFile as FileDto | null;
    return !file || file.isDirectory === true;
};

export interface FileBrowserHotkeyDeps {
    selection: ReturnType<typeof useFileSelection>;
    pointedElement: string | null;
    clipboard: ReturnType<typeof useClipboard>;
    nav: ReturnType<typeof useNavigation>;
    startRename: (path: string) => void;
    createFolder: (currentPath: string) => void | Promise<void>;
    requestDelete: (paths: string[]) => void;
}

/** Keyboard shortcuts for the file browser (rename, delete, clipboard, navigation, selection). */
export const buildFileBrowserHotkeys = ({
    selection, pointedElement, clipboard, nav, startRename, createFolder, requestDelete,
}: FileBrowserHotkeyDeps): HotkeyDescriptor[] => [
    {
        id: 'select-file',
        key: 'F2',
        title: <>F2. Rename {selection.primary ?? pointedElement}</>,
        enabledWhen: (ctx: CommandContext) =>
            isFolderView(ctx) && (
                (!!selection.primary && isFilePath(selection.primary)) ||
                (!!ctx.pointedElement && isFilePath(ctx.pointedElement!))
            ),
        execute: async () => {
            const target = selection.primary ?? pointedElement;
            if (target && isFilePath(target)) {
                startRename(target);
            }
        }
    },
    {
        id: 'delete-files',
        key: 'Delete',
        title: <>Delete. Delete selected</>,
        enabledWhen: (ctx: CommandContext) =>
            isFolderView(ctx) && (
                selection.selectedCount > 0 ||
                (!!ctx.pointedElement && isFilePath(ctx.pointedElement!))
            ),
        execute: async (ctx: CommandContext) => {
            const targets = selection.selectedCount > 0
                ? selection.getSelected()
                : (ctx.pointedElement ? [ctx.pointedElement] : []);
            requestDelete(targets);
        }
    },
    {
        id: 'select-all',
        key: 'Mod+A',
        title: <>Ctrl+A. Select all</>,
        enabledWhen: (ctx: CommandContext) => isFolderView(ctx),
        execute: async () => {
            selection.selectAll(selection.getVisiblePaths());
        }
    },
    {
        id: 'clear-selection',
        key: 'Escape',
        title: <>Esc. Clear selection</>,
        enabledWhen: (ctx: CommandContext) =>
            isFolderView(ctx) && (selection.selectedCount > 0 || clipboard.hasEntries()),
        execute: async () => {
            if (clipboard.hasEntries()) clipboard.clear();
            selection.clear();
        }
    },
    {
        id: 'cut-files',
        key: 'Mod+X',
        title: <>Ctrl+X. Cut</>,
        enabledWhen: (ctx: CommandContext) => isFolderView(ctx) && selection.selectedCount > 0,
        execute: async () => {
            clipboard.cut(selection.getSelected());
        }
    },
    {
        id: 'copy-files',
        key: 'Mod+C',
        title: <>Ctrl+C. Copy</>,
        enabledWhen: (ctx: CommandContext) => isFolderView(ctx) && selection.selectedCount > 0,
        execute: async () => {
            clipboard.copy(selection.getSelected());
        }
    },
    {
        id: 'paste-files',
        key: 'Mod+V',
        title: <>Ctrl+V. Paste</>,
        enabledWhen: (ctx: CommandContext) => isFolderView(ctx) && clipboard.hasEntries(),
        execute: async (ctx: CommandContext) => {
            await clipboard.paste(ctx.currentPath);
        }
    },
    {
        id: 'new-folder-shortcut',
        key: 'Mod+Shift+N',
        title: <>Ctrl+Shift+N. New folder</>,
        enabledWhen: (ctx: CommandContext) => isFolderView(ctx),
        execute: (ctx: CommandContext) => createFolder(ctx.currentPath),
    },
    {
        id: 'open-primary',
        key: 'Enter',
        title: <>Enter. Open</>,
        enabledWhen: (ctx: CommandContext) => isFolderView(ctx) && !!selection.primary,
        execute: async () => {
            if (selection.primary) nav.open(selection.primary);
        },
    },
    {
        id: 'go-up',
        key: 'Backspace',
        title: <>Backspace. Go up</>,
        enabledWhen: (ctx: CommandContext) => isFolderView(ctx) && !!ctx.currentPath,
        execute: async () => {
            nav.goUp();
        },
    },
    {
        id: 'select-down',
        key: 'ArrowDown',
        title: <>↓. Next</>,
        enabledWhen: (ctx: CommandContext) => isFolderView(ctx),
        execute: async () => {
            selection.movePrimary(1, false);
        },
    },
    {
        id: 'select-up',
        key: 'ArrowUp',
        title: <>↑. Previous</>,
        enabledWhen: (ctx: CommandContext) => isFolderView(ctx),
        execute: async () => {
            selection.movePrimary(-1, false);
        },
    },
    {
        id: 'select-down-range',
        key: 'Shift+ArrowDown',
        title: <>Shift+↓. Extend</>,
        enabledWhen: (ctx: CommandContext) => isFolderView(ctx),
        execute: async () => {
            selection.movePrimary(1, true);
        },
    },
    {
        id: 'select-up-range',
        key: 'Shift+ArrowUp',
        title: <>Shift+↑. Extend</>,
        enabledWhen: (ctx: CommandContext) => isFolderView(ctx),
        execute: async () => {
            selection.movePrimary(-1, true);
        },
    },
];
