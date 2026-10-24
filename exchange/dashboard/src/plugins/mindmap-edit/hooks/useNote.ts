import { useCallback, useEffect, useRef } from 'react';
import { useSelectionContext, Clipboard, useWorkerClient, toStoredLink, useFileBrowsingPersistenceContext } from '@cms-core';
import { HEIGHT, WIDTH } from '../lib/geom2d';

import { randomWord } from './randomWord';
import { findFavicon, linkNoteContent } from '../lib/link-note';
import { USER_BOUND_AUTO, MindmapRect, newNoteProperties, instanceOfNote, restyledNote } from '../model';
import { useMindmapStateContext, useMindmapMode } from '../state';
import { useRelateNotes } from './useRelation';

/** How long a new note is given to be measured and centred before it opens for editing. */
const SETTLING_DELAY = 100;

export const useCreateNote = () => {
    const { mindmap, addElement, patchElement, saveMindmap, pointedLocation, newNoteStyle } = useMindmapStateContext();
    const [selection, setSelection] = useSelectionContext();
    const [, setMode] = useMindmapMode();

    const relateNotes = useRelateNotes();

    // A note is asked for at a point, but its size is only known once the browser has laid its
    // text out, so it is born at that point and slides half a size up and left once measured.
    const toCenter = useRef<{ id: string, center: number[] } | null>(null);

    useEffect(() => {
        const pending = toCenter.current;
        if (!pending) return;

        const note = (mindmap?.elements.notes ?? [])
            .find(element => element.id === pending.id) as MindmapRect | undefined;
        const measured = note?.bounds;
        if (!measured || !measured[WIDTH] || !measured[HEIGHT]) return;

        toCenter.current = null;
        const left = Math.round(pending.center[0] - measured[WIDTH] / 2);
        const top = Math.round(pending.center[1] - measured[HEIGHT] / 2);
        patchElement<MindmapRect>('notes', pending.id, {
            userBounds: [left, top, USER_BOUND_AUTO, USER_BOUND_AUTO],
            bounds: [left, top, measured[WIDTH], measured[HEIGHT]]
        });
        saveMindmap();
    }, [mindmap, patchElement, saveMindmap]);

    /**
     * Leave a note holding `content` centred on `at`, related to the notes `relatedTo` names —
     * by default the selected ones, a note being usually asked for next to what it speaks of.
     */
    return useCallback((content?: string, at?: number[], relatedTo?: string[]) => {
        const id = 'NOTE-' + randomWord(8);
        const center = at ?? pointedLocation;

        addElement('notes', {
            id,
            userBounds: [center[0], center[1], USER_BOUND_AUTO, USER_BOUND_AUTO],
            bounds: [center[0], center[1], 0, 0],
            content: content || 'Note ' + id,
            zIndex: 3,
            ...newNoteProperties(newNoteStyle)
        });
        toCenter.current = { id, center };

        relateNotes(id, relatedTo ?? selection);
        saveMindmap();

        setTimeout(() => {
            if (toCenter.current?.id === id) toCenter.current = null;
            setSelection([id]);
            setMode("EDIT_MODIFY_ELEMENT");
        }, SETTLING_DELAY);

    }, [addElement, pointedLocation, newNoteStyle, setSelection, setMode, saveMindmap, relateNotes, selection]);
}

export const useCreateNoteGroup = () => {
    const { mapElements, saveMindmap } = useMindmapStateContext();
    const [selection] = useSelectionContext();

    return useCallback(() => {
        if (selection.length < 2) return;

        const groupId = 'GROUP-' + randomWord(8);
        mapElements((element) => {
            if (selection.includes(element.id)) {
                return { ...element, group: groupId } as MindmapRect;
            }
            return element;
        });
        saveMindmap();
    }, [mapElements, selection, saveMindmap]);
};

export const useUngroupNotes = () => {
    const { mapElements, saveMindmap } = useMindmapStateContext();
    const [selection] = useSelectionContext();

    return useCallback(() => {
        if (selection.length === 0) return;

        mapElements((element) => {
            if (selection.includes(element.id)) {
                const { group, ...rest } = element as MindmapRect;
                return rest as MindmapRect;
            }
            return element;
        });
        saveMindmap();
    }, [mapElements, selection, saveMindmap]);
};

/**
 * Hand the style the top bar holds — normally the look of notes still to come — to the notes
 * already drawn and selected. It goes through without asking: what it touches is what is
 * visibly selected, and the boxes it applies are in sight above.
 */
export const useApplyStyleToSelection = () => {
    const { mapElements, saveMindmap, newNoteStyle } = useMindmapStateContext();
    const [selection] = useSelectionContext();

    return useCallback(() => {
        if (selection.length === 0) return;

        mapElements((element) => (selection.includes(element.id) && instanceOfNote(element))
            ? restyledNote(element, newNoteStyle)
            : element);
        saveMindmap();
    }, [mapElements, saveMindmap, selection, newNoteStyle]);
};

// === Paste Helpers ===

const isLink = (str: string) => str.startsWith("http://")
    || str.startsWith("https://")
    || str.startsWith("./")
    || str.startsWith("../")
    || str.startsWith("/");

export const usePasteLink = () => {
    const { saveMindmap } = useMindmapStateContext();
    const { currentFile } = useFileBrowsingPersistenceContext();
    const createNote = useCreateNote();

    return useCallback(async () => {
        const clipboardText = await Clipboard.getClipboardText();
        if (isLink(clipboardText)) {
            // A link copied from this app's address bar is stored bare, so the note survives a
            // change of domain or of context path. findFavicon then declines it, as it does any
            // link with no site of its own to fetch one from.
            const link = toStoredLink(clipboardText);
            createNote(linkNoteContent(link, await findFavicon(link)));
            saveMindmap();
        }
    }, [saveMindmap, currentFile, createNote]);
}

export const usePasteCode = () => {
    const { saveMindmap } = useMindmapStateContext();
    const { currentFile } = useFileBrowsingPersistenceContext();
    const createNote = useCreateNote();

    return useCallback(async () => {
        const clipboardText = await Clipboard.getClipboardText();
        if (clipboardText.length > 0) {
            createNote(`\`\`\`{{{language}}}\n${clipboardText}\n\`\`\``);
            saveMindmap();
        }
    }, [saveMindmap, currentFile, createNote]);
}

export const usePasteImage = () => {
    const { saveMindmap } = useMindmapStateContext();
    const { currentPath } = useFileBrowsingPersistenceContext();
    const createNote = useCreateNote();
    const client = useWorkerClient();

    return useCallback(async () => {
        const clipboardText = await Clipboard.getClipboardImage();
        if (clipboardText && clipboardText.length > 0) {
            // Convert data URL to file
            const filename = `IMG-${randomWord(8)}.png`;
            const file = dataURLtoFile(clipboardText, filename);

            // Upload file
            // We can't really await the upload here if we want to be snappy, but for safety lets await
            // or we could show a placeholder?
            // The requirement says "upload?", checking the text: "create a new image file (upload?)".
            // So uploading seems correct.

            await client.upload(currentPath, file, {});

            const fullPath = currentPath ? `${currentPath}/${filename}` : filename;
            createNote(`![${filename}](${fullPath})`);
            saveMindmap();
        }
    }, [saveMindmap, currentPath, createNote, client]);
}

function dataURLtoFile(dataurl: string, filename: string): File {
    const arr = dataurl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
}
