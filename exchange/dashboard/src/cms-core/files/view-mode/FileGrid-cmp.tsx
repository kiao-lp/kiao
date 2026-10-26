import React, { useEffect, useMemo } from 'react';
import { FileDto, WorkerClient, parentPath } from '../service';
import { useFileBrowsingPersistenceContext } from '../core/FileBrowsingPersistence-ctx';
import { useCurrentFileListContext, useRefreshFileList } from '../core/CurrentFileList-ctx';
import { FileUploadArea, useWorkerClient } from '../service/ui';
import { Pointable } from 'react-advanced-interactions';
import { FileLabelSwitch } from '../core/FileLabelSwitch-cmp';
import { SilentLink } from '../core/SilentLink-cmp';
import { useFileSelection } from '../selection/SelectionModel-ctx';
import { useClipboard } from '../clipboard/ClipboardModel-ctx';
import { useRowInteractions } from '../browser/useRowInteractions';
import { useRowDndHandlers } from '../dnd/DragDropController';
import { DraggedFile, draggedSelection } from '../dnd/dragPaths';
import { RowContextMenu } from '../context-menu/RowContextMenu';
import { EmptyAreaContextMenu } from '../context-menu/EmptyAreaContextMenu';
import { useIsCoarsePointer, useLongPressContextMenu } from '../browser/useLongPress';

export type FileGridProps = {
    exclude?: (file: FileDto) => boolean;
};

interface GridItem {
    key: string;
    value: string;
    file?: FileDto;
    isUpRow?: boolean;
    label: React.ReactNode;
}

interface TileProps {
    item: GridItem;
    visiblePaths: string[];
    currentPath: string;
    selected: DraggedFile[];
    client: WorkerClient;
    refreshFileList: () => void;
    isCurrent: boolean;
    isSelected: boolean;
    isCut: boolean;
}

const Tile: React.FC<TileProps> = ({
    item, visiblePaths, currentPath, selected,
    client, refreshFileList,
    isCurrent, isSelected, isCut,
}) => {
    const isCoarse = useIsCoarsePointer();
    const dnd = useRowDndHandlers({
        row: { file: item.file, value: item.value, isUpRow: !!item.isUpRow },
        currentPath,
        selected,
        client,
        refreshFileList,
        enabled: !item.isUpRow && !isCoarse,
    });
    const interactions = useRowInteractions({
        path: item.value,
        visiblePaths,
        isFolder: !!item.file?.isDirectory,
    });
    const longPress = useLongPressContextMenu(!item.isUpRow);

    const handlers = item.isUpRow ? {} : interactions;

    const classes = ['cms-file-tile'];
    if (isSelected) classes.push('cms-row-selected');
    if (isCurrent) classes.push('cms-row-current');
    if (isCut) classes.push('cms-row-cut');

    const tile = (
        <div
            className={classes.join(' ')}
            data-row-path={item.value}
            draggable={dnd.draggable}
            onDragStart={dnd.onDragStart}
            onDragOver={dnd.onDragOver}
            onDragLeave={dnd.onDragLeave}
            onDrop={dnd.onDrop}
            {...handlers}
            onPointerDown={longPress.onPointerDown}
            onPointerUp={longPress.onPointerUp}
            onPointerMove={longPress.onPointerMove}
            onPointerCancel={longPress.onPointerCancel}
        >
            {item.label}
        </div>
    );

    if (item.isUpRow) return tile;
    return (
        <RowContextMenu path={item.value} isDirectory={!!item.file?.isDirectory}>
            {tile}
        </RowContextMenu>
    );
};

const fileToGridItem = (file: FileDto): GridItem => ({
    key: file.path,
    value: file.path,
    file,
    label: (
        <Pointable id={file.path}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }} data-testid={`browser-item-${file.path}`}>
                <FileLabelSwitch file={file} />
            </div>
        </Pointable>
    ),
});

export const FileGridCmp: React.FC<FileGridProps> = ({ exclude = () => false }) => {
    const { currentFile, currentPath } = useFileBrowsingPersistenceContext();
    const files = useCurrentFileListContext();
    const workerClient = useWorkerClient() as WorkerClient;
    const refreshFileList = useRefreshFileList();
    const selection = useFileSelection();
    const clipboard = useClipboard();

    // The folder's own tiles, and nothing else: the search results open as a panel on the
    // central area's stack (FileSearchResultsView), over this grid rather than in place of it.
    const items: GridItem[] = useMemo(() => {
        const upPath = currentPath ? parentPath(currentPath) : '';
        const upRow: GridItem[] = currentPath ? [{
            key: 'UP',
            value: 'UP',
            isUpRow: true,
            label: (
                <SilentLink to={upPath} style={{ color: 'inherit' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>..</div>
                </SilentLink>
            ),
        }] : [];

        const sortByName = (a: FileDto, b: FileDto) => a.path.toLowerCase().localeCompare(b.path.toLowerCase());
        const directories = files.filter(f => f.isDirectory && !exclude(f)).sort(sortByName);
        const nonDirectories = files.filter(f => !f.isDirectory && !exclude(f)).sort(sortByName);

        return [...upRow, ...directories.map(fileToGridItem), ...nonDirectories.map(fileToGridItem)];
    }, [files, currentPath, exclude]);

    const visiblePaths = useMemo(
        () => items.filter(i => !i.isUpRow).map(i => i.value),
        [items],
    );
    // Kinds and all: a drag says whether what it carries is a folder, and only the listing knows.
    const selected = draggedSelection(selection.getSelected(), files);

    useEffect(() => {
        selection.setVisiblePaths(visiblePaths);
    }, [selection, visiblePaths]);

    return (
        <>
            <EmptyAreaContextMenu>
                <div className="cms-file-grid">
                    {items.map(item => (
                        <Tile
                            key={item.key}
                            item={item}
                            visiblePaths={visiblePaths}
                            currentPath={currentPath}
                            selected={selected}
                            client={workerClient}
                            refreshFileList={refreshFileList}
                            isCurrent={item.value === currentFile?.path}
                            isSelected={selection.isSelected(item.value)}
                            isCut={clipboard.isCut(item.value)}
                        />
                    ))}
                </div>
            </EmptyAreaContextMenu>
            <FileUploadArea path={currentPath} />
        </>
    );
};
