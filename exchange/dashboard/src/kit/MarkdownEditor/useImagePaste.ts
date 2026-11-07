import React, { useState } from 'react';
import { extractName, useWorkerClient } from '@cms-core';
import type { ImagePasteModalProps, ImagePasteResult } from './ImagePasteModal';
import { buildImageMarkdown, findImageFile, imageLinkPath } from './imagePaste';

/** Paste handler and dialog props for pasted images; the caller supplies `insert`. Links are relative to the document folder, or from the store root when `linkFromRoot` or outside that folder. */
export interface ImagePasteBox {
    /** Spread onto the element an image may be pasted into. */
    onPasteCapture: (event: React.ClipboardEvent) => void;
    /** Spread onto an `ImagePasteModal` rendered beside it. */
    modalProps: ImagePasteModalProps;
}

export const useImagePaste = (
    /** Root-relative folder; `''` is the store root. */
    documentFolder: string,
    /** Seeds the offered image name. */
    documentName: string,
    insert: (snippet: string) => void,
    /** Link from the store root even if the image is beside the document. */
    linkFromRoot = false,
): ImagePasteBox => {
    const client = useWorkerClient();
    const [image, setImage] = useState<File | null>(null);
    // Store root `/` is normalised to '' to avoid `//name`.
    const folder = documentFolder === '/' ? '' : documentFolder;

    const onPasteCapture = (event: React.ClipboardEvent) => {
        const file = findImageFile(event.clipboardData);
        if (!file) return;
        // Prevent the editor from also pasting the text fallback.
        event.preventDefault();
        event.stopPropagation();
        setImage(file);
    };

    const onConfirm = async (result: ImagePasteResult) => {
        if (result.storage === 'file' && result.path) {
            await client.update(result.path, result.blob);
            insert(buildImageMarkdown(extractName(result.path), encodeURI(imageLinkPath(result.path, folder, linkFromRoot))));
        } else {
            insert(buildImageMarkdown('image', result.dataUrl));
        }
        setImage(null);
    };

    return {
        onPasteCapture,
        modalProps: {
            image,
            defaultDirectory: folder,
            documentName,
            onCancel: () => setImage(null),
            onConfirm,
        },
    };
};
