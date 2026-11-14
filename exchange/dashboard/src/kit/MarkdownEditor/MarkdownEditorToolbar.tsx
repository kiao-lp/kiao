import React, { useState } from 'react';
import { Space, Button, Dropdown } from 'antd';
import { CodeOutlined, EyeOutlined, MinusSquareOutlined, PlusSquareOutlined, AudioOutlined, AppstoreAddOutlined, ExportOutlined } from '@ant-design/icons';
import { ZoomControl } from '@kiao-dashboard-core';
import type { MarkdownEditorToolbarControlProps } from './useMarkdownEditorControls';
import { InsertMenu } from './InsertMenu';
import { SyncScrollToggle } from './SyncScrollToggle';
import { mermaidBlock } from './mermaidTemplates';
import { ExportModal } from './ExportModal';

const PREVIEW_ZOOM_LEVELS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

export type MarkdownEditorToolbarProps = MarkdownEditorToolbarControlProps & {
    extra?: React.ReactNode;
};
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
                    <Button aria-label="Fold All Sections"
                        type="text"
                        size="small"
                        icon={<MinusSquareOutlined />}
                        onClick={() => editorRef.current?.foldAll()}
                    />
                    <Button aria-label="Unfold All Sections"
                        type="text"
                        size="small"
                        icon={<PlusSquareOutlined />}
                        onClick={() => editorRef.current?.unfoldAll()}
                    />
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
                        <Button aria-label="Insert"
                            type="text"
                            size="small"
                            icon={<AppstoreAddOutlined />}
                        />
                    </Dropdown>
                </>
            )}
            <Button aria-label={isCodeMirror ? "Switch to Voice Editor" : "Switch to CodeMirror Editor"}
                type="text"
                size="small"
                icon={<AudioOutlined />}
                style={{ color: !isCodeMirror ? 'var(--link)' : undefined, opacity: !isCodeMirror ? 1 : 0.5 }}
                onClick={() => setEditorMode(isCodeMirror ? 'voice' : 'codemirror')}
            />
            <Button
                type="text"
                size="small"
                icon={<ExportOutlined />}
                aria-label="Export"
                onClick={() => setExportOpen(true)}
            />
            <ExportModal
                open={exportOpen}
                onClose={() => setExportOpen(false)}
                onExportPdf={theme => editorRef.current?.downloadPdf(theme)}
                onExportDocx={theme => editorRef.current?.downloadDocx(theme) ?? Promise.resolve()}
            />
            <Button aria-label={showSource ? "Hide Editor" : "Show Editor"}
                type="text"
                size="small"
                icon={<CodeOutlined />}
                disabled={showSource && !showPreview}
                style={{ color: showSource ? 'var(--link)' : undefined, opacity: showSource ? 1 : 0.5 }}
                onClick={() => setShowSource(!showSource)}
            />
            <Button aria-label={showPreview ? "Hide Preview" : "Show Preview"}
                type="text"
                size="small"
                icon={<EyeOutlined />}
                disabled={showPreview && !showSource}
                style={{ color: showPreview ? 'var(--link)' : undefined, opacity: showPreview ? 1 : 0.5 }}
                onClick={() => setShowPreview(!showPreview)}
            />
            {/* In the bar, not the pane, so it does not cover the text. */}
            {showPreview && (
                <ZoomControl
                    zoom={previewZoom}
                    onZoomChange={setPreviewZoom}
                    zoomLevels={PREVIEW_ZOOM_LEVELS}
                    className="markdown-preview-zoom"
                />
            )}
            {isCodeMirror && showSource && showPreview && (
                <SyncScrollToggle value={syncScroll} onChange={setSyncScroll} />
            )}
        </Space>
    );
};
