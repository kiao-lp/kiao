import React, { useState } from 'react';
import { extractName, useWorkerClient } from '@cms-core';
import type { ImagePasteModalProps, ImagePasteResult } from './ImagePasteModal';
import { buildImageMarkdown, findImageFile, imageLinkPath } from './imagePaste';

/**
 * Taking a pasted image into a document: the paste handler for the box it is dropped into, and the
 * dialog that asks where it goes.
 *
 * A screenshot is pasted into whatever editor happens to be in front of the user — the markdown
 * editor's source pane, the flow node panel's box — and each of them wants the same three things: to
 * catch the paste before the editor makes plain text of it, to write the file where the user says,
 * and to put a markdown image link in its place. Only the last one differs, so it is the caller's:
 * `insert` is handed the snippet and puts it where its own caret is.
 *
 * The link is written against `documentFolder` (`imageLinkPath`), which is what makes it read the
 * same in this CMS, on GitHub and in an IDE preview — relative to the document when the image sits
 * beside it, from the store root when it does not. Content held nowhere (`linkFromRoot`) is always
 * written from the store root: a card has no document for a relative link to resolve against.
 */
export interface ImagePasteBox {
    /** Spread onto the element an image may be pasted into. */
    onPasteCapture: (event: React.ClipboardEvent) => void;
    /** Spread onto an `ImagePasteModal` rendered beside it. */
    modalProps: ImagePasteModalProps;
}

export const useImagePaste = (
    /** Root-relative folder of the document being edited, `''` being the store root. */
    documentFolder: string,
    /** Its name, which seeds the unique name the image is offered. */
    documentName: string,
    insert: (snippet: string) => void,
    /** Write the link from the store root even when the image sits beside the document. */
    linkFromRoot = false,
): ImagePasteBox => {
    const client = useWorkerClient();
    const [image, setImage] = useState<File | null>(null);
    // A document at the store root has `/` for a folder, which would name the image `//shot.png`.
    // The root is the empty string everywhere below.
    const folder = documentFolder === '/' ? '' : documentFolder;

    const onPasteCapture = (event: React.ClipboardEvent) => {
        const file = findImageFile(event.clipboardData);
        if (!file) return;
        // Keep CodeMirror — or the textarea — from also pasting whatever text fallback came with it.
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
