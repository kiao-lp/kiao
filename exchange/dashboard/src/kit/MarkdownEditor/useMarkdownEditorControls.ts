import { useCallback, useRef, RefObject } from 'react';
import { useFileViewState } from '@kiao-dashboard-core';
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

/** Editor ref and per-file view state shared by body and toolbar. Defaults seed files never opened; toggles and preview zoom persist per file. */
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
        // Only the preview zooms; the source keeps the editor size.
        previewZoom: 1,
    });
    const { showSource, editorMode, syncScroll, previewZoom } = panes;
    const showPreview = panes.showPreview || !showSource;

    const setShowSource = useCallback((v: boolean) => setPanes(prev => {
        const showPreview = prev.showPreview || !prev.showSource;
        return { showSource: v || !showPreview, showPreview };
    }), [setPanes]);
    const setShowPreview = useCallback((v: boolean) => setPanes(prev => ({ showPreview: v || !prev.showSource })), [setPanes]);
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
