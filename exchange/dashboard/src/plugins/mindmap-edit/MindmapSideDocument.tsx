import React from 'react';
import { NodeIndexOutlined } from '@ant-design/icons';
import type { WorkerClient } from 'kiao-worker';
import type { FileDto, SideDocumentDeclaration, SideDocumentContext } from '@cms-core';

import { MindmapStateProvider } from './state';
import { MindmapCommandsProvider } from './commands';
import { MindmapViewportCmp } from './components/MindmapViewport';
import { MindmapDragAndDropProvider } from './components/MindmapDragAndDrop';
import { RelationDragProvider } from './components/RelationDrag-ctx';
import { MindmapZoomControl } from './components/MindmapZoomControl';
import { NewColorControl } from './components/NewColorControl';
import { NewNoteStyleControl } from './components/NewNoteStyleControl';
import { NewRelationStyleControl } from './components/NewRelationStyleControl';
import { emptyMindmapDocument } from './model';

const extension = '.mmap.json';

/**
 * The map, as it is drawn beside another document rather than on its own. Same viewport, same
 * commands, same state — only the chrome differs: a mindmap of its own has the zoom control and
 * the styles new notes and new relations are made with in the top banner, whereas a pane cannot
 * reach it and pins a bar of its own instead.
 */
const MindmapPane: React.FC<{ path: string }> = ({ path }) => (
    <MindmapStateProvider mindmapId={path}>
        <MindmapCommandsProvider>
            <div className="mindmap-side-bar">
                <NewColorControl />
                <NewNoteStyleControl />
                <NewRelationStyleControl />
                <MindmapZoomControl />
            </div>
            <MindmapDragAndDropProvider>
                <RelationDragProvider>
                    <MindmapViewportCmp />
                </RelationDragProvider>
            </MindmapDragAndDropProvider>
        </MindmapCommandsProvider>
    </MindmapStateProvider>
);

/**
 * A mindmap offered beside any other document, at that document's path with `.mmap.json` appended
 * — `notes.md` is mapped by `notes.md.mmap.json`. The map is created the first time the pane is
 * switched on, so no document carries an empty one it never asked for.
 *
 * Nothing here names markdown: which documents can actually be shown with a map is decided by the
 * plugins that accept side documents (they render `<SideDocumentRow>`), not by this plugin. A map
 * is the one thing not offered a map of its own.
 */
export const mindmapSideDocument: SideDocumentDeclaration = {
    id: 'mindmap',
    title: 'Mindmap',
    icon: <NodeIndexOutlined />,
    pathFor: (hostFile: FileDto) =>
        hostFile.path.endsWith(extension) ? null : `${hostFile.path}${extension}`,
    create: (path: string, client: WorkerClient) =>
        client.saveDocument(path, emptyMindmapDocument()),
    render: ({ path }: SideDocumentContext) => <MindmapPane path={path} />,
};
