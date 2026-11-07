import React, { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import type { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { ConfiguredMarkdown, extractName, parentPath, useFileBrowsingPersistenceContext, useTextFragment, PassageContextMenu, SplitRow, type EditableBlock, type SplitPart, VoiceTextArea, printMarkdownToPdf, type PdfTheme, escapeKiaoDiagramCode, isKiaoDiagramRange } from '@cms-core';
import { CodeMirrorMarkdownEditor, CodeMirrorMarkdownEditorRef } from './CodeMirrorMarkdownEditor';
import { ImagePasteModal } from './ImagePasteModal';
import { ArchDiaBlockModal } from './ArchDiaBlockModal';
import { ArchDiaExtractModal } from './ArchDiaExtractModal';
import { buildFencedBlockEdit } from './fencedBlock';
import { handleMarkdownTextareaKey } from './markdownInlineFormat';
import { useImagePaste } from './useImagePaste';
import { useMarkdownScrollSync } from './useMarkdownScrollSync';
import { useCursorFromQuery } from './useCursorFromQuery';
import { anchorAtTop, restoreAnchor, type PreviewAnchor } from './previewAnchor';
import { exportMarkdownToDocx, storePathOfImage, useWorkerClient } from '@cms-core';

export type EditorMode = 'codemirror' | 'voice';

export interface MarkdownEditorBodyRef {
    foldAll: () => void;
    unfoldAll: () => void;
    formatTables: () => void;
    insertTable: (rows: number, cols: number) => void;
    insertRowBelow: () => void;
    insertColumnRight: () => void;
    insertBlock: (text: string) => void;
    isCursorInTable: () => boolean;
    downloadPdf: (theme?: PdfTheme) => void;
    downloadDocx: (theme?: PdfTheme) => Promise<void>;
}

export type MarkdownEditorBodyProps = {
    value: string;
    onChange: (value: string) => void;
    pdfTitle?: string;
    showSource?: boolean;
    showPreview?: boolean;
    editorMode?: EditorMode;
    syncScroll?: boolean;
    /** Preview only; the source pane is not zoomed. 1 = pane size. */
    previewZoom?: number;
    /** Only when the preview is the open document itself. Off for hosts with no URL for the content. */
    passageLinks?: boolean;
    /** Must be constant or memoized: a new value reconfigures the editor. */
    extensions?: Extension;
    /** Overrides the browsed file's folder for pasted images and their links. */
    imageFolder?: string;
    imageDocumentName?: string;
    /** Write pasted-image links from the store root. */
    imageLinksFromRoot?: boolean;
    style?: React.CSSProperties;
};

/** Controlled source and preview; the host loads and saves the file. */
export const MarkdownEditorBody = forwardRef<MarkdownEditorBodyRef, MarkdownEditorBodyProps>(
    ({ value, onChange, pdfTitle, showSource = true, showPreview = true, editorMode = 'codemirror', syncScroll = true, previewZoom = 1, passageLinks = false, extensions, imageFolder, imageDocumentName, imageLinksFromRoot = false, style }, ref) => {
        const editorRef = useRef<CodeMirrorMarkdownEditorRef>(null);
        const previewRef = useRef<HTMLDivElement>(null);
        const { currentFile } = useFileBrowsingPersistenceContext();
        const client = useWorkerClient();
        const exportingDocx = useRef(false);
        const [editedDiagram, setEditedDiagram] = useState<EditableBlock | null>(null);
        const [extractedDiagram, setExtractedDiagram] = useState<EditableBlock | null>(null);
        const [editorView, setEditorView] = useState<EditorView | null>(null);

        const bothPanesVisible = showSource && showPreview;
        useMarkdownScrollSync({
            enabled: syncScroll && bothPanesVisible,
            view: editorView,
            getPreview: () => previewRef.current,
        });

        useTextFragment(previewRef, passageLinks && showPreview);

        // Only the open document answers; gated by passageLinks.
        useCursorFromQuery(editorView, passageLinks);

        // Hold the top block across a zoom change; pixel offsets shift on relayout.
        const readAt = useRef<PreviewAnchor | null>(null);
        const rememberPlace = () => {
            const pane = previewRef.current;
            if (pane) readAt.current = anchorAtTop(pane);
        };
        const zoomOnScreen = useRef(previewZoom);
        useLayoutEffect(() => {
            const pane = previewRef.current;
            // No restore when the zoom did not change, e.g. on open.
            if (!pane || zoomOnScreen.current === previewZoom) return;
            zoomOnScreen.current = previewZoom;
            if (readAt.current) restoreAnchor(pane, readAt.current);
        }, [previewZoom]);

        useImperativeHandle(ref, () => ({
            foldAll: () => editorRef.current?.foldAll(),
            unfoldAll: () => editorRef.current?.unfoldAll(),
            formatTables: () => editorRef.current?.formatTables(),
            insertTable: (rows: number, cols: number) => editorRef.current?.insertTable(rows, cols),
            insertRowBelow: () => editorRef.current?.insertRowBelow(),
            insertColumnRight: () => editorRef.current?.insertColumnRight(),
            insertBlock: (text: string) => editorRef.current?.insertBlock(text),
            isCursorInTable: () => editorRef.current?.isCursorInTable() ?? false,
            downloadPdf: (theme?: PdfTheme) => {
                const container = previewRef.current?.querySelector('.configured-markdown-container');
                if (!container) return;
                printMarkdownToPdf(container as HTMLElement, { title: pdfTitle || 'document', theme });
            },
            downloadDocx: async (theme?: PdfTheme) => {
                if (exportingDocx.current) return;
                exportingDocx.current = true;
                const key = 'markdown-docx-export';
                const progress = (content: string) => message.open({ key, type: 'loading', content, duration: 0 });
                progress('Preparing Word export…');
                try {
                    // Capture this render's controlled value: pending autosaves are irrelevant.
                    const blob = await exportMarkdownToDocx(value, {
                        title: pdfTitle || 'document',
                        theme,
                        onProgress: progress,
                        loadResource: async src => {
                            if (/^(https?:|data:|blob:)/i.test(src)) {
                                const response = await fetch(src, { signal: AbortSignal.timeout(30000) });
                                if (!response.ok) throw new Error(`Image answered ${response.status}: ${src}`);
                                return response.blob();
                            }
                            return client.getFileBlob(storePathOfImage(decodeURIComponent(src), documentFolder));
                        },
                    });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `${(pdfTitle || 'document').replace(/[\\/:*?"<>|]/g, '_')}.docx`;
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 60000);
                    message.open({ key, type: 'success', content: 'Word document downloaded', duration: 4 });
                } catch (error) {
                    message.open({ key, type: 'error', content: `Word export failed: ${error instanceof Error ? error.message : String(error)}`, duration: 10 });
                } finally {
                    exportingDocx.current = false;
                }
            },
        }));

        const handleTextAreaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            onChange(e.target.value);
        };

        const documentPath = currentFile && !currentFile.isDirectory ? currentFile.path : null;
        const documentFolder = imageFolder
            ?? (documentPath ? parentPath(documentPath) : (currentFile?.path ?? ''));
        const documentName = imageDocumentName
            ?? (documentPath ? extractName(documentPath) : 'image');

        const insertMarkdown = (snippet: string) => {
            if (editorRef.current) {
                editorRef.current.insertBlock(snippet);
            } else {
                // Voice mode has no caret API: append as a trailing block
                const separator = value.trim() === '' ? '' : '\n\n';
                onChange(value + separator + snippet);
            }
        };

        const imagePaste = useImagePaste(documentFolder, documentName, insertMarkdown, imageLinksFromRoot);

        // plantuml/mermaid are converted in and written back as archdia.
        const blockEditors = useMemo(
            () => ({ archdia: setEditedDiagram, plantuml: setEditedDiagram, mermaid: setEditedDiagram }),
            [],
        );

        // Only archdia has a diagram to extract.
        const blockExtractors = useMemo(() => ({ archdia: setExtractedDiagram }), []);

        const replaceBlock = (block: EditableBlock, body: string, newLanguage: string) => {
            // Keep kiao:diagram escaping; raw `A-->B` would close the comment.
            const writeBody = isKiaoDiagramRange(value, block.range.start)
                ? escapeKiaoDiagramCode(body)
                : body;
            const edit = buildFencedBlockEdit(value, block.range, block.language, writeBody, newLanguage);
            if (!edit) {
                message.error('The diagram block moved in the source, so the change was not applied.');
                return;
            }
            if (value.slice(edit.from, edit.to) === edit.text) return;

            // Ranged edit keeps caret, folds and one undo step.
            if (!editorRef.current?.replaceRange(edit.from, edit.to, edit.text)) {
                onChange(value.slice(0, edit.from) + edit.text + value.slice(edit.to));
            }
        };

        const handleDiagramConfirm = (body: string) => {
            const block = editedDiagram;
            setEditedDiagram(null);
            if (block) replaceBlock(block, body, 'archdia');
        };

        const handleDiagramExtract = (source: string) => {
            const block = extractedDiagram;
            setExtractedDiagram(null);
            if (block) replaceBlock(block, source, 'plantuml');
        };

        // No menu off-document: it replaces the browser menu.
        const withPassageLinks = (rendered: React.ReactElement) =>
            passageLinks && documentPath
                ? <PassageContextMenu path={documentPath}>{rendered}</PassageContextMenu>
                : rendered;

        const panes: SplitPart[] = [];
        if (showSource) panes.push({
            name: 'source',
            onPasteCapture: imagePaste.onPasteCapture,
            style: { borderRight: showPreview ? '1px solid var(--border)' : 'none', overflow: 'hidden', backgroundColor: 'var(--bg)' },
            children: editorMode === 'codemirror' ? (
                <CodeMirrorMarkdownEditor
                    ref={editorRef}
                    value={value}
                    onChange={onChange}
                    onViewReady={setEditorView}
                    extensions={extensions}
                />
            ) : (
                <VoiceTextArea
                    value={value}
                    onChange={handleTextAreaChange}
                    onKeyDown={(event) => { handleMarkdownTextareaKey(event, value, onChange); }}
                    style={{
                        height: '100%',
                        width: '100%',
                        resize: 'none',
                        fontFamily: 'monospace'
                    }}
                />
            ),
        });
        if (showPreview) panes.push({
            name: 'preview',
            ref: previewRef,
            onScroll: rememberPlace,
            style: { overflow: 'auto', padding: '20px', backgroundColor: 'var(--bg)' },
            // `zoom` inside the scroller: relayout at read size, pane keeps its column.
            children: withPassageLinks(
                <div style={{ zoom: previewZoom }}>
                    <ConfiguredMarkdown
                        showCopyHtml={true}
                        sourceLineAttributes={bothPanesVisible}
                        blockEditors={blockEditors}
                        blockExtractors={blockExtractors}
                    >
                        {value}
                    </ConfiguredMarkdown>
                </div>
            ),
        });

        return (
            <>
                <SplitRow id="markdown" style={style} parts={panes} />
                <ImagePasteModal {...imagePaste.modalProps} />
                <ArchDiaBlockModal
                    block={editedDiagram}
                    onCancel={() => setEditedDiagram(null)}
                    onConfirm={handleDiagramConfirm}
                />
                <ArchDiaExtractModal
                    block={extractedDiagram}
                    onCancel={() => setExtractedDiagram(null)}
                    onConfirm={handleDiagramExtract}
                />
            </>
        );
    }
);

MarkdownEditorBody.displayName = 'MarkdownEditorBody';
