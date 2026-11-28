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

/** Accepts only the first entry when the field holds a single path. */
export const useFileDrop = (onFile: (file: DraggedFile) => void): FileDrop =>
    useFilesDrop(([file]) => onFile(file));

/** Leaves non-store drags to the browser and keeps accepted drops inside the target. */
export const useFilesDrop = (onFiles: (files: DraggedFile[]) => void): FileDrop => {
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
                const files = readDraggedFiles(event.dataTransfer);
                if (!files.length) return;
                event.preventDefault();
                event.stopPropagation();
                onFiles(files);
            },
        },
    };
};
