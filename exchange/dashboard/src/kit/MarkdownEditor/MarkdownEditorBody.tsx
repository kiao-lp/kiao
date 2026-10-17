import React, { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import type { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { ConfiguredMarkdown, extractName, parentPath, useFileBrowsingPersistenceContext, useCodeMirrorScrollMemory, useScrollMemory, useTextFragment, PassageContextMenu, SplitRow, type EditableBlock, type SplitPart, VoiceTextArea, printMarkdownToPdf, type PdfTheme, escapeKiaoDiagramCode, isKiaoDiagramRange } from '@cms-core';
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
    /** Markdown source (controlled). */
    value: string;
    onChange: (value: string) => void;
    /** Title used for document exports (PDF and Word). */
    pdfTitle?: string;
    showSource?: boolean;
    showPreview?: boolean;
    editorMode?: EditorMode;
    /** Keep the preview scrolled to the block the source pane is showing. */
    syncScroll?: boolean;
    /**
     * How large the preview is read at, 1 being the size the pane gives it. The source pane keeps
     * the editor's own size: what is zoomed here is the document as it will be read, not the text
     * being typed.
     */
    previewZoom?: number;
    /**
     * Whether to reopen the panes where they were left. Off for content that is not the open file
     * — one section of it, say, where the remembered line belongs to no document in particular.
     */
    scrollMemory?: boolean;
    /**
     * Whether the preview is a view of the open document itself, and so can be linked into by
     * passage: a text fragment in the URL is resolved and highlighted here, and a right-click on
     * selected text offers the link back (see cms-core/text-fragment/). Off by default, for the
     * hosts editing something the store has no URL for — a flow node's description in a modal, where
     * such a link would name a document that does not hold the passage.
     */
    passageLinks?: boolean;
    /**
     * CodeMirror extensions on top of the source pane's own — a host's rule about the text it is
     * editing, say. A constant, or memoized: a new value reconfigures the editor.
     */
    extensions?: Extension;
    /**
     * Where a pasted image is offered to go, and what its link is written against — for content
     * the store holds no document for (a flow node's description), where the browsed file's folder
     * would be the wrong answer on both counts. Left unset, both come from the file being browsed,
     * as they do for a document.
     */
    imageFolder?: string;
    /** The name the offered image is made unique from, beside `imageFolder`. */
    imageDocumentName?: string;
    /** Write pasted-image links from the store root — for content with no document to read a
     * relative link against. */
    imageLinksFromRoot?: boolean;
    style?: React.CSSProperties;
};

/**
 * File-agnostic, controlled markdown editing experience: a CodeMirror (or voice)
 * source editor next to a live `ConfiguredMarkdown` preview, with imperative
 * fold / format / PDF-export commands. File loading & saving are intentionally
 * left to the host (see markdown-edit's MarkdownFileEditor).
 * Pasting an image into the source pane opens `ImagePasteModal`; the browsed
 * file (when any) seeds the default image path.
 */
export const MarkdownEditorBody = forwardRef<MarkdownEditorBodyRef, MarkdownEditorBodyProps>(
    ({ value, onChange, pdfTitle, showSource = true, showPreview = true, editorMode = 'codemirror', syncScroll = true, previewZoom = 1, scrollMemory = true, passageLinks = false, extensions, imageFolder, imageDocumentName, imageLinksFromRoot = false, style }, ref) => {
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

        // A URL naming a passage opens the document on it: found in the rendered
        // preview, highlighted, and scrolled to where it reads best.
        const passage = useTextFragment(previewRef, passageLinks && showPreview);

        // A URL asking for the caret at the end opens a backlog just appended to: the source pane
        // lands after the link so the comment is typed where it belongs. Only the open document
        // answers — hence `passageLinks`, which is what says this preview is the file itself.
        useCursorFromQuery(editorView, passageLinks);

        // Reopen the document where it was left. The source pane is remembered as
        // a line so it survives the document being re-read or re-wrapped; the
        // preview is remembered only when it is not already being driven by the
        // source pane's own restore.
        //
        // A passage link answers the same question, and wins: the panes it drives
        // stay out of the memory for the whole visit — not restored from it, which
        // would fight the passage as it is being placed, and not written to it,
        // since arriving on a passage is not the reader leaving their place
        // somewhere new. The source pane counts as driven only while sync is
        // carrying the preview's scroll across to it.
        const passageDrivesSource = passage.active && syncScroll && bothPanesVisible;
        useCodeMirrorScrollMemory(editorView, 'editorLine', scrollMemory && showSource && !passageDrivesSource);
        useScrollMemory(previewRef, 'previewTop', scrollMemory && showPreview && !(syncScroll && bothPanesVisible) && !passage.active);

        // Zooming lays the preview out again, and a pane left at the pixel it was scrolled to
        // would then be showing a different part of the document — the further down, the further
        // off. The block at the top of the pane is what is held across the change instead (see
        // `previewAnchor`), so the passage being read is still the one on screen at the new size.
        const readAt = useRef<PreviewAnchor | null>(null);
        const rememberPlace = () => {
            const pane = previewRef.current;
            if (pane) readAt.current = anchorAtTop(pane);
        };
        const zoomOnScreen = useRef(previewZoom);
        useLayoutEffect(() => {
            const pane = previewRef.current;
            // Nothing to put back when the pane opens: the zoom it opens at is the one it was
            // left at, and the scroll memory owns where it starts.
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
        // Where the pasted image is offered to go, and what its link is written against — the
        // host's say, where the host is editing something the store holds no document for.
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

        // Rendered diagrams offer an edit button, which opens the archdia editor
        // on that block alone; `blockEditors` is keyed by fence language. The
        // other two languages are converted on the way in, and come back — and
        // are written back — as archdia.
        const blockEditors = useMemo(
            () => ({ archdia: setEditedDiagram, plantuml: setEditedDiagram, mermaid: setEditedDiagram }),
            [],
        );

        // The way back out: an archdia block can give up the plantuml diagram it
        // holds. Only archdia has anything to extract — the other two languages
        // are already what one would extract to.
        const blockExtractors = useMemo(() => ({ archdia: setExtractedDiagram }), []);

        /** Write a block's new body back into the source, retagged as `newLanguage`. */
        const replaceBlock = (block: EditableBlock, body: string, newLanguage: string) => {
            // A block carried in a kiao:diagram comment keeps its escaping: an `A-->B` written raw
            // would close the comment early.
            const writeBody = isKiaoDiagramRange(value, block.range.start)
                ? escapeKiaoDiagramCode(body)
                : body;
            const edit = buildFencedBlockEdit(value, block.range, block.language, writeBody, newLanguage);
            if (!edit) {
                message.error('The diagram block moved in the source, so the change was not applied.');
                return;
            }
            if (value.slice(edit.from, edit.to) === edit.text) return;

            // A ranged transaction keeps the caret, the folds and a single undo
            // step; pushing a new `value` down would replace the whole document.
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

        // The rendered document under a right-click that offers the link to whatever is selected in
        // it. Left plain where the pane is not a view of a document of the store: the menu takes
        // the browser's own away, and would be giving nothing back.
        const withPassageLinks = (rendered: React.ReactElement) =>
            passageLinks && documentPath
                ? <PassageContextMenu path={documentPath}>{rendered}</PassageContextMenu>
                : rendered;

        // The two panes as the row lays them out: one share of the width each until the reader
        // drags the handle between them (see cms-core/split/).
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
            /*
             * `zoom`, not `transform: scale`, and on a box inside the scroller rather than on the
             * pane: the document is laid out again at the size it is read at — text rasterised
             * crisp, a diagram drawn from its geometry, tables re-wrapped — while the pane keeps
             * the column the layout gave it and goes on scrolling in screen pixels.
             */
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
