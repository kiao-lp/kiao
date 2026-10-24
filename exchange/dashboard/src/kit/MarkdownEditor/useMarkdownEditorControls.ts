import { useCallback, useRef, RefObject } from 'react';
import { useFileViewState } from '@cms-core';
import { EditorMode, MarkdownEditorBodyRef } from './MarkdownEditorBody';

export interface UseMarkdownEditorControlsOptions {
    defaultShowSource?: boolean;
    defaultShowPreview?: boolean;
    defaultEditorMode?: EditorMode;
    defaultSyncScroll?: boolean;
}

export interface MarkdownEditorBodyControlProps {
    showSource: boolean;
    showPreview: boolean;
    editorMode: EditorMode;
    syncScroll: boolean;
    previewZoom: number;
}

export interface MarkdownEditorToolbarControlProps {
    editorRef: RefObject<MarkdownEditorBodyRef>;
    showSource: boolean;
    setShowSource: (v: boolean) => void;
    showPreview: boolean;
    setShowPreview: (v: boolean) => void;
    editorMode: EditorMode;
    setEditorMode: (m: EditorMode) => void;
    syncScroll: boolean;
    setSyncScroll: (v: boolean) => void;
    previewZoom: number;
    setPreviewZoom: (z: number) => void;
}

export interface MarkdownEditorControls {
    editorRef: RefObject<MarkdownEditorBodyRef>;
    showSource: boolean;
    setShowSource: (v: boolean) => void;
    showPreview: boolean;
    setShowPreview: (v: boolean) => void;
    editorMode: EditorMode;
    setEditorMode: (m: EditorMode) => void;
    syncScroll: boolean;
    setSyncScroll: (v: boolean) => void;
    previewZoom: number;
    setPreviewZoom: (z: number) => void;
    /** Spread onto <MarkdownEditorBody> (plus value/onChange/pdfTitle/ref). */
    bodyProps: MarkdownEditorBodyControlProps;
    /** Spread onto <MarkdownEditorToolbar>. */
    toolbarProps: MarkdownEditorToolbarControlProps;
}

/**
 * Bundles the editor ref and the view-state (source/preview/editor-mode) shared
 * between <MarkdownEditorBody> and <MarkdownEditorToolbar>, so a host wires them
 * up with two spreads and they stay in sync.
 *
 * The four toggles and the preview's zoom are remembered per file, so reopening a
 * document — or coming back from the login redirect a failed token renewal
 * triggers — shows the panes as they were left, at the size they were read at. The
 * `default*` options only seed a file never opened before.
 */
export const useMarkdownEditorControls = (
    options: UseMarkdownEditorControlsOptions = {}
): MarkdownEditorControls => {
    const {
        defaultShowSource = true,
        defaultShowPreview = true,
        defaultEditorMode = 'codemirror',
        defaultSyncScroll = true,
    } = options;

    const editorRef = useRef<MarkdownEditorBodyRef>(null);
    const [panes, setPanes] = useFileViewState('markdown', {
        showSource: defaultShowSource,
        showPreview: defaultShowPreview,
        editorMode: defaultEditorMode as EditorMode,
        syncScroll: defaultSyncScroll,
        // A document nobody has zoomed is read at its own size; only the preview has a zoom,
        // the source pane keeping the editor's.
        previewZoom: 1,
    });
    const { showSource, showPreview, editorMode, syncScroll, previewZoom } = panes;

    const setShowSource = useCallback((v: boolean) => setPanes({ showSource: v }), [setPanes]);
    const setShowPreview = useCallback((v: boolean) => setPanes({ showPreview: v }), [setPanes]);
    const setEditorMode = useCallback((m: EditorMode) => setPanes({ editorMode: m }), [setPanes]);
    const setSyncScroll = useCallback((v: boolean) => setPanes({ syncScroll: v }), [setPanes]);
    const setPreviewZoom = useCallback((z: number) => setPanes({ previewZoom: z }), [setPanes]);

    return {
        editorRef,
        showSource,
        setShowSource,
        showPreview,
        setShowPreview,
        editorMode,
        setEditorMode,
        syncScroll,
        setSyncScroll,
        previewZoom,
        setPreviewZoom,
        bodyProps: { showSource, showPreview, editorMode, syncScroll, previewZoom },
        toolbarProps: {
            editorRef,
            showSource,
            setShowSource,
            showPreview,
            setShowPreview,
            editorMode,
            setEditorMode,
            syncScroll,
            setSyncScroll,
            previewZoom,
            setPreviewZoom,
        },
    };
};
