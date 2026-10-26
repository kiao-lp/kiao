import React, { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { RenameModal } from './RenameModal-cmp';
import { RenameTargetProvider, useRenameTarget } from '../selection/RenameTarget-ctx';
import { PluginListProvider } from 'src/cms-core/core/PluginList-ctx';
import { FileBasedPlugin, FileTypeConfig } from 'src/cms-core/core/FileBasedPlugin';
import { FileDto } from 'src/cms-core/files/service';

vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn(),
}));

vi.mock('../../ui/VoiceInput', () => ({
    VoiceInput: ({ onPressEnter: _onPressEnter, ...rest }: any) => <input {...rest} />,
}));

vi.mock('antd', async (importOriginal) => {
    const actual = await importOriginal<typeof import('antd')>();
    return {
        ...actual,
        Modal: ({ open, afterOpenChange, children }: any) => {
            useEffect(() => {
                if (open) {
                    // Deferred like the real modal's open animation, so the input
                    // already holds the target name when focus/selection runs.
                    const timer = setTimeout(() => afterOpenChange?.(true), 0);
                    return () => clearTimeout(timer);
                }
            }, [open, afterOpenChange]);
            return open ? <div data-testid="rename-modal">{children}</div> : null;
        },
    };
});

vi.mock('./FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => ({ currentFile: null, currentPath: '/' }),
}));

const fileList = vi.hoisted(() => [
    { path: '/dir/notes.mmap.json', isDirectory: false, size: 0, lastModified: 0 },
    { path: '/dir/photo.png', isDirectory: false, size: 0, lastModified: 0 },
    { path: '/dir/data.json', isDirectory: true, size: 0, lastModified: 0 },
    { path: '/dir/01 - Todo.tasks.md', isDirectory: false, size: 0, lastModified: 0 },
] as FileDto[]);

vi.mock('./CurrentFileList-ctx', () => ({
    useCurrentFileListContext: () => fileList,
    useRefreshFileList: () => vi.fn(),
}));

vi.mock('src/cms-core/files/service/ui', () => ({
    useWorkerClient: () => ({ rename: vi.fn() }),
}));

const mindmapPlugin: FileBasedPlugin = {
    fileConfigFor: (file: FileDto) => file.path.endsWith('.mmap.json')
        ? { fileLabelCmp: () => null, mainView: () => null } as FileTypeConfig
        : null,
    fileExtensions: ['.mmap.json'],
};

/** Declares an extension without claiming the file — hybridflow-ui's arrangement. */
const tasksPlugin: FileBasedPlugin = {
    fileConfigFor: () => null,
    fileExtensions: ['.tasks.md'],
};

const markdownPlugin: FileBasedPlugin = {
    fileConfigFor: (file: FileDto) => file.path.endsWith('.md')
        ? { fileLabelCmp: () => null, mainView: () => null } as FileTypeConfig
        : null,
    fileExtensions: ['.md'],
};

const Trigger: React.FC<{ path: string }> = ({ path }) => {
    const { startRename } = useRenameTarget();
    return <button onClick={() => startRename(path)}>rename</button>;
};

const renderModal = (path: string) => render(
    <PluginListProvider plugins={[mindmapPlugin, tasksPlugin, markdownPlugin]}>
        <RenameTargetProvider>
            <RenameModal />
            <Trigger path={path} />
        </RenameTargetProvider>
    </PluginListProvider>,
);

const inputSelection = () => {
    const input = screen.getByTestId('rename-input') as HTMLInputElement;
    return [input.selectionStart, input.selectionEnd];
};

const openRename = async (path: string) => {
    renderModal(path);
    await act(async () => {
        screen.getByRole('button', { name: 'rename' }).click();
        // Let the modal's deferred focus/selection callback run.
        await new Promise(resolve => setTimeout(resolve, 20));
    });
};

describe('RenameModal initial selection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('selects only the base name for a file with a known extension', async () => {
        await openRename('/dir/notes.mmap.json');

        await waitFor(() => expect(screen.getByTestId('rename-input')).toHaveValue('notes.mmap.json'));
        await waitFor(() => expect(inputSelection()).toEqual([0, 5]));
    });

    it('selects the whole name when the file type is unknown', async () => {
        await openRename('/dir/photo.png');

        await waitFor(() => expect(screen.getByTestId('rename-input')).toHaveValue('photo.png'));
        await waitFor(() => expect(inputSelection()).toEqual([0, 9]));
    });

    it('keeps an extension declared by a plugin that does not claim the file', async () => {
        await openRename('/dir/01 - Todo.tasks.md');

        await waitFor(() => expect(screen.getByTestId('rename-input')).toHaveValue('01 - Todo.tasks.md'));
        await waitFor(() => expect(inputSelection()).toEqual([0, 9]));
    });

    it('selects the whole name for a directory whose name ends in a known extension', async () => {
        await openRename('/dir/data.json');

        await waitFor(() => expect(screen.getByTestId('rename-input')).toHaveValue('data.json'));
        await waitFor(() => expect(inputSelection()).toEqual([0, 9]));
    });
});
