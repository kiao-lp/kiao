import React, { useState } from 'react';
import { Space, Button, Dropdown } from 'antd';
import { Tooltip } from '@cms-core';
import { CodeOutlined, EyeOutlined, MinusSquareOutlined, PlusSquareOutlined, AudioOutlined, AppstoreAddOutlined, ExportOutlined } from '@ant-design/icons';
import { ZoomControl } from '../ZoomControl';
import type { MarkdownEditorToolbarControlProps } from './useMarkdownEditorControls';
import { InsertMenu } from './InsertMenu';
import { SyncScrollToggle } from './SyncScrollToggle';
import { mermaidBlock } from './mermaidTemplates';
import { ExportModal } from './ExportModal';

/**
 * What the preview offers to be read at.
 *
 * Finer around 100% than the steps a diagram is zoomed by, and it never goes below half: this is
 * prose, where a quarter of the size is not a smaller document but an unreadable one.
 */
const PREVIEW_ZOOM_LEVELS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

export type MarkdownEditorToolbarProps = MarkdownEditorToolbarControlProps & {
    /** Extra controls rendered before the shared toggles (e.g. a language selector). */
    extra?: React.ReactNode;
};

/**
 * Shared toolbar for the markdown editor: fold/unfold, an Insert menu (tables &
 * mermaid diagrams), voice toggle, export (PDF or Word, with theme), source/preview
 * visibility, the size the preview is read at, and scroll sync. Driven by the state
 * & editor ref from `useMarkdownEditorControls`.
 * Centralizing it here means new actions appear in every host (markdown-edit
 * and every other markdown host).
 */
export const MarkdownEditorToolbar: React.FC<MarkdownEditorToolbarProps> = ({
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
    extra,
}) => {
    const isCodeMirror = editorMode === 'codemirror';
    const [insertOpen, setInsertOpen] = useState(false);
    const [inTable, setInTable] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);

    return (
        <Space size={2}>
            {extra}
            {isCodeMirror && (
                <>
                    <Tooltip title="Fold All Sections">
                        <Button
                            type="text"
                            size="small"
                            icon={<MinusSquareOutlined />}
                            onClick={() => editorRef.current?.foldAll()}
                        />
                    </Tooltip>
                    <Tooltip title="Unfold All Sections">
                        <Button
                            type="text"
                            size="small"
                            icon={<PlusSquareOutlined />}
                            onClick={() => editorRef.current?.unfoldAll()}
                        />
                    </Tooltip>
                    <Dropdown
                        trigger={['click']}
                        open={insertOpen}
                        onOpenChange={(next) => {
                            if (next) {
                                setInTable(editorRef.current?.isCursorInTable() ?? false);
                            }
                            setInsertOpen(next);
                        }}
                        popupRender={() => (
                            <InsertMenu
                                inTable={inTable}
                                onInsertTable={(rows, cols) => editorRef.current?.insertTable(rows, cols)}
                                onInsertRow={() => editorRef.current?.insertRowBelow()}
                                onInsertColumn={() => editorRef.current?.insertColumnRight()}
                                onFormat={() => editorRef.current?.formatTables()}
                                onInsertDiagram={(body) => editorRef.current?.insertBlock(mermaidBlock(body))}
                                onClose={() => setInsertOpen(false)}
                            />
                        )}
                    >
                        <Tooltip title="Insert">
                            <Button
                                type="text"
                                size="small"
                                icon={<AppstoreAddOutlined />}
                            />
                        </Tooltip>
                    </Dropdown>
                </>
            )}
            <Tooltip title={isCodeMirror ? "Switch to Voice Editor" : "Switch to CodeMirror Editor"}>
                <Button
                    type="text"
                    size="small"
                    icon={<AudioOutlined />}
                    style={{ color: !isCodeMirror ? 'var(--link)' : undefined, opacity: !isCodeMirror ? 1 : 0.5 }}
                    onClick={() => setEditorMode(isCodeMirror ? 'voice' : 'codemirror')}
                />
            </Tooltip>
            <Tooltip title="Export">
                <Button
                    type="text"
                    size="small"
                    icon={<ExportOutlined />}
                    aria-label="Export"
                    onClick={() => setExportOpen(true)}
                />
            </Tooltip>
            <ExportModal
                open={exportOpen}
                onClose={() => setExportOpen(false)}
                onExportPdf={theme => editorRef.current?.downloadPdf(theme)}
                onExportDocx={theme => editorRef.current?.downloadDocx(theme) ?? Promise.resolve()}
            />
            <Tooltip title={showSource ? "Hide Editor" : "Show Editor"}>
                <Button
                    type="text"
                    size="small"
                    icon={<CodeOutlined />}
                    style={{ color: showSource ? 'var(--link)' : undefined, opacity: showSource ? 1 : 0.5 }}
                    onClick={() => setShowSource(!showSource)}
                />
            </Tooltip>
            <Tooltip title={showPreview ? "Hide Preview" : "Show Preview"}>
                <Button
                    type="text"
                    size="small"
                    icon={<EyeOutlined />}
                    style={{ color: showPreview ? 'var(--link)' : undefined, opacity: showPreview ? 1 : 0.5 }}
                    onClick={() => setShowPreview(!showPreview)}
                />
            </Tooltip>
            {/* The preview's own size, next to the switch that put it on screen. It lives in the
                bar rather than in the pane because the pane is the document being read: a control
                floating over it would cover the text, and a column of its own would take from the
                width that is the point of zooming in the first place. */}
            {showPreview && (
                <ZoomControl
                    zoom={previewZoom}
                    onZoomChange={setPreviewZoom}
                    zoomLevels={PREVIEW_ZOOM_LEVELS}
                    className="markdown-preview-zoom"
                />
            )}
            {/* Nothing to keep in sync unless both panes are on screen. */}
            {isCodeMirror && showSource && showPreview && (
                <SyncScrollToggle value={syncScroll} onChange={setSyncScroll} />
            )}
        </Space>
    );
};
