import React, { useMemo } from 'react';
import { theme, message } from 'antd';
import { WorkerClient, FileDto, parentPath } from '../service';
import { DraggedFile, draggedPaths, writeDraggedFiles } from './dragPaths';

export interface RowDndDescriptor {
    file?: FileDto;
    value: string;
    isUpRow: boolean;
}

export interface RowDndOptions {
    row: RowDndDescriptor;
    currentPath: string;
    /** The tiles selected right now, kinds and all — what a tile of the selection drags. */
    selected: DraggedFile[];
    client: WorkerClient;
    refreshFileList: () => void;
    enabled: boolean;
}

const basename = (path: string): string => path.split('/').pop() || path;

const joinPath = (folder: string, name: string): string => {
    const f = folder.replace(/\/$/, '');
    return f ? `${f}/${name}` : name;
};

const computeTargetFolder = (row: RowDndDescriptor, currentPath: string): string | null => {
    if (row.isUpRow) return parentPath(currentPath || '');
    if (row.file?.isDirectory) return row.value;
    return null;
};

const canDropOnto = (row: RowDndDescriptor): boolean => row.isUpRow || !!row.file?.isDirectory;

export const useRowDndHandlers = (opts: RowDndOptions) => {
    const { token } = theme.useToken();
    const { row, currentPath, selected, client, refreshFileList, enabled } = opts;

    return useMemo(() => {
        if (!enabled) {
            return {
                draggable: false as const,
                onDragStart: undefined,
                onDragOver: undefined,
                onDragLeave: undefined,
                onDrop: undefined,
            };
        }

        const draggable = !row.isUpRow;

        const onDragStart = (e: React.DragEvent) => {
            if (row.isUpRow) return;
            // A tile of the selection drags the whole of it; a tile outside it drags itself alone.
            const inSelection = selected.some(file => file.path === row.value);
            writeDraggedFiles(e.dataTransfer, inSelection && selected.length > 1
                ? selected
                : [{ path: row.value, isDirectory: !!row.file?.isDirectory }]);
        };

        const onDragOver = (e: React.DragEvent<HTMLElement>) => {
            if (!canDropOnto(row)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            (e.currentTarget as HTMLElement).style.backgroundColor = token.colorFillSecondary;
        };

        const onDragLeave = (e: React.DragEvent<HTMLElement>) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = '';
        };

        const onDrop = async (e: React.DragEvent<HTMLElement>) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).style.backgroundColor = '';

            const sources = draggedPaths(e.dataTransfer);
            if (sources.length === 0) return;

            const targetFolder = computeTargetFolder(row, currentPath);
            if (targetFolder === null) return;

            const toMove = sources.filter(src => joinPath(targetFolder, basename(src)) !== src);
            if (toMove.length === 0) return;

            try {
                await client.moveBatch(toMove, targetFolder);
            } catch (error) {
                // No per-entry retry: the service link-fixes the whole store once per request, so
                // a retry loop repeats that walk N times — see performCut in clipboardOps.
                console.error('Drag-move batch failure', error);
                message.error(`Could not move ${toMove.length} ${toMove.length === 1 ? 'item' : 'items'} to ${targetFolder || '/'}`);
            }
            refreshFileList();
        };

        return { draggable, onDragStart, onDragOver, onDragLeave, onDrop };
    }, [enabled, row, currentPath, selected, client, refreshFileList, token.colorFillSecondary]);
};
