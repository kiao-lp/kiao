/**
 * Accept only the first store entry: a path field holds one path. Leave non-store drags to
 * the browser, and stop accepted drops from reaching attachment handlers on parent panels.
 */

import type React from 'react';
import { useState } from 'react';
import { DraggedFile, holdsDraggedFiles, readDraggedFiles } from './dragPaths';

export interface FileDropProps {
    onDragOver: React.DragEventHandler<HTMLElement>;
    onDragLeave: React.DragEventHandler<HTMLElement>;
    onDrop: React.DragEventHandler<HTMLElement>;
}

export interface FileDrop {
    dropping: boolean;
    dropProps: FileDropProps;
}

export const useFileDrop = (onFile: (file: DraggedFile) => void): FileDrop => {
    const [dropping, setDropping] = useState(false);

    return {
        dropping,
        dropProps: {
            // Cancel dragover as well as drop; otherwise the browser refuses the drop.
            onDragOver: event => {
                if (!holdsDraggedFiles(event.dataTransfer)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                setDropping(true);
            },
            onDragLeave: () => setDropping(false),
            onDrop: event => {
                setDropping(false);
                const [dropped] = readDraggedFiles(event.dataTransfer);
                if (!dropped) return;
                event.preventDefault();
                event.stopPropagation();
                onFile(dropped);
            },
        },
    };
};
