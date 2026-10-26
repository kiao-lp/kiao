import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createSimpleContext } from 'react-concise';
import {
    CommandContext, Clipboard, usePluginHotkeys, useSelectionContext, useCleanSelectionAndPointing,
    useFileBrowsingPersistenceContext
} from '@cms-core';

// State & Models
import { useMindmapStateContext, useMindmapMode } from '../state';
import { randomWord } from '../hooks/randomWord';
import { useDeleteElements } from '../hooks/useDeleteElement';
import { clipboardMindmap, copiedMindmap, elementsOf, pastedElements } from '../lib/mindmap-clipboard';
import { CutConfirmModal } from '../components/CutConfirmModal-cmp';

/** A name for a pasted element, of the kind its prefix says — how every element here is named. */
const freshId = (prefix: string) => prefix + randomWord(8);

interface MindmapClipboardValue {
    copy: (ids: string[]) => Promise<void>;
    cut: (ids: string[]) => Promise<void>;
    paste: () => Promise<void>;
}

const defaultValue: MindmapClipboardValue = {
    copy: async () => { },
    cut: async () => { },
    paste: async () => { },
};

/**
 * Copy, cut and paste, on the keys every program puts them on.
 *
 * Cutting is a copy that *asks* before taking anything away, and goes on asking: what has been
 * copied is on the system clipboard, so the paste may well be about to happen in another tab, and
 * the source cannot know whether it has. So the dialog waits, and the notes stay on the map until
 * someone says they may go — before pasting or long after, whichever suits. The Delete key is
 * unchanged and asks nothing: what it takes is not on any clipboard, and there is nothing to wait
 * for.
 *
 * The three verbs live in this context so the right-click menu says the same ones the keys do.
 */
const useMindmapClipboardValue = (): MindmapClipboardValue & {
    pendingCut: string[] | null;
    confirmCut: () => void;
    cancelCut: () => void;
} => {
    const [mode] = useMindmapMode();
    const { mindmap, addElements, saveMindmap } = useMindmapStateContext();
    const [, setSelection] = useSelectionContext();
    const cleanSelectionAndPointing = useCleanSelectionAndPointing();
    const deleteElements = useDeleteElements();

    // What a cut has put on the clipboard and is waiting to be allowed to take off the map, or
    // nothing when no cut is waiting. Held rather than recomputed from the selection: the answer
    // may come long after, and by then the selection is whatever has been done since.
    const [pendingCut, setPendingCut] = useState<string[] | null>(null);

    // The question is about the map it was asked on, and can only be answered there: this editor
    // moved on to another map would take "delete" and have nothing of that name to delete, saying
    // it had done what it had not. The clipboard is untouched, so the piece is still there to
    // paste — what is dropped is only the offer to take the original away.
    const { currentFile } = useFileBrowsingPersistenceContext();
    useEffect(() => { setPendingCut(null); }, [currentFile?.path]);

    /**
     * Puts that piece of the map on the clipboard, and says what went.
     *
     * Which piece is read off the context the key press carries rather than off what this render
     * closed over: a hotkey is registered from an effect, so the descriptor in the registry is
     * the one built before the selection last changed, and a Ctrl+C pressed straight after a
     * second note was gathered used to copy the first alone. The dispatcher builds the context in
     * the render that saw the change, so it cannot be behind the key that reaches it.
     */
    const write = useCallback(async (ids: string[]): Promise<string[]> => {
        if (!mindmap) return [];
        const copied = copiedMindmap(mindmap, ids);
        const taken = elementsOf(copied.elements);
        if (taken.length === 0) return [];

        await Clipboard.setClipboard(JSON.stringify(copied));
        return taken.map(element => element.id);
    }, [mindmap]);

    // The selection is kept: a copy leaves the map exactly as it was, and what was copied is
    // what one goes on working with.
    const copy = useCallback(async (ids: string[]) => { await write(ids); }, [write]);

    const cut = useCallback(async (ids: string[]) => {
        const taken = await write(ids);
        if (taken.length > 0) setPendingCut(taken);
    }, [write]);

    const paste = useCallback(async () => {
        if (!mindmap) return;

        const clipboard = clipboardMindmap(await Clipboard.getClipboardText());
        if (!clipboard) return;

        const pasted = pastedElements(clipboard, mindmap, freshId);
        const landed = elementsOf(pasted);
        if (landed.length === 0) return;

        addElements(pasted);
        saveMindmap();
        // What was just pasted is what is now selected — it lands on top of whatever it was
        // copied from, so nothing else would tell the copy from the original.
        setSelection(landed.map(element => element.id));
    }, [mindmap, addElements, saveMindmap, setSelection]);

    const confirmCut = useCallback(() => {
        if (pendingCut) {
            deleteElements(pendingCut);
            cleanSelectionAndPointing();
        }
        setPendingCut(null);
    }, [pendingCut, deleteElements, cleanSelectionAndPointing]);

    const cancelCut = useCallback(() => setPendingCut(null), []);

    usePluginHotkeys('mindmap-clipboard', [
        {
            id: 'copy-elements',
            key: 'Mod+C',
            title: <>Ctrl+C. Copy</>,
            enabledWhen: (ctx: CommandContext) => mode === 'EDIT' && ctx.selection.length > 0,
            execute: (ctx: CommandContext) => copy(ctx.selection)
        },
        {
            id: 'cut-elements',
            key: 'Mod+X',
            title: <>Ctrl+X. Cut</>,
            enabledWhen: (ctx: CommandContext) =>
                mode === 'EDIT' && ctx.selection.length > 0 && pendingCut === null,
            execute: (ctx: CommandContext) => cut(ctx.selection)
        },
        {
            id: 'paste-elements',
            key: 'Mod+V',
            title: <>Ctrl+V. Paste</>,
            enabledWhen: () => mode === 'EDIT',
            execute: paste
        }
    ], [mode, pendingCut, copy, cut, paste]);

    return useMemo(
        () => ({ copy, cut, paste, pendingCut, confirmCut, cancelCut }),
        [copy, cut, paste, pendingCut, confirmCut, cancelCut]
    );
};

const hookBasedContext = createSimpleContext(useMindmapClipboardValue, {
    ...defaultValue, pendingCut: null, confirmCut: () => { }, cancelCut: () => { },
});

export const useMindmapClipboard = (): MindmapClipboardValue => {
    const { copy, cut, paste } = hookBasedContext.useContext();
    return useMemo(() => ({ copy, cut, paste }), [copy, cut, paste]);
};

const CutModal: React.FC = () => {
    const { pendingCut, confirmCut, cancelCut } = hookBasedContext.useContext();
    return <CutConfirmModal pending={pendingCut} onConfirm={confirmCut} onCancel={cancelCut} />;
};

export const MindmapClipboardProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
    <hookBasedContext.Provider>
        {children}
        <CutModal />
    </hookBasedContext.Provider>
);
