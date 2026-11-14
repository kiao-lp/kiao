import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createSimpleContext } from 'react-concise';
import {
    CommandContext, Clipboard, usePluginHotkeys, useSelectionContext, useCleanSelectionAndPointing,
    useFileBrowsingPersistenceContext
} from '@kiao-dashboard-core';

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

/** Copy, cut and paste, on the keys every program puts them on. */
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

    const [pendingCut, setPendingCut] = useState<string[] | null>(null);

    // The question is about the map it was asked on, and can only be answered there: this editor paste — what is dropped is only.
    const { currentFile } = useFileBrowsingPersistenceContext();
    useEffect(() => { setPendingCut(null); }, [currentFile?.path]);


    const write = useCallback(async (ids: string[]): Promise<string[]> => {
        if (!mindmap) return [];
        const copied = copiedMindmap(mindmap, ids);
        const taken = elementsOf(copied.elements);
        if (taken.length === 0) return [];

        await Clipboard.setClipboard(JSON.stringify(copied));
        return taken.map(element => element.id);
    }, [mindmap]);

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
