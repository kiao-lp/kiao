import React from 'react';

import { MindmapViewportCmp } from './MindmapViewport';
import { MindmapDragAndDropProvider } from './MindmapDragAndDrop';
import { RelationDragProvider } from './RelationDrag-ctx';

export const MindmapPanel: React.FC = () => (
    <div className="mindmap-panel">
        <MindmapDragAndDropProvider>
            <RelationDragProvider>
                <MindmapViewportCmp />
            </RelationDragProvider>
        </MindmapDragAndDropProvider>
    </div>
);
