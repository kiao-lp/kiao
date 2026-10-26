import React, { useCallback, useRef, useState } from 'react';
import { Modal, Alert } from 'antd';
import type { EditableBlock } from '@cms-core';
import {
    ArchDiaEditor,
    ArchDiaViewState,
    ContentBox,
    ARCHDIA_CSS_VARS,
    getCombinedSource,
    serializeSvgForExport,
    downloadFile,
    fitToContent,
    normalizePositions,
} from '@cms-kit/archdia';
import { themeMode } from 'kiao-style';
import { useTheme } from '../../ThemeContext';
import { useArchDiaDraft } from './useArchDiaDraft';

export interface ArchDiaBlockModalProps {
    /** The block being edited; `null` keeps the dialog closed. */
    block: EditableBlock | null;
    onCancel: () => void;
    /** Called with the block's new body once the reader validates. */
    onConfirm: (body: string) => void;
}

/**
 * The full archdia editor over a diagram embedded in a markdown document.
 *
 * Everything is edited in memory: dragging, relayouting and typing change only
 * the draft, and the host is handed the new block body just once, on validation
 * — a markdown file is not rewritten per mouse-up the way an `.arch.md` file is.
 *
 * A `plantuml` or `mermaid` block is converted to archdia to be edited, which is
 * a one-way trip: applying replaces the original block. The dialog's title and
 * its `Convert & apply` button say which, and cancelling keeps the block as it is.
 */
export const ArchDiaBlockModal: React.FC<ArchDiaBlockModalProps> = ({ block, onCancel, onConfirm }) => {
    const { theme } = useTheme();
    const draft = useArchDiaDraft(block?.code ?? null, block?.language);
    /** The language being converted away from, or `null` when the block is already archdia. */
    const convertingFrom = block && block.language !== 'archdia' ? block.language : null;
    const bodyRef = useRef<HTMLDivElement>(null);
    const contentBoxRef = useRef<ContentBox | null>(null);

    // Ephemeral: the dialog is destroyed on close, and each diagram in a
    // document deserves its own zoom rather than one shared with its neighbours.
    const [viewState, setViewState] = useState<ArchDiaViewState>({});
    const mergeViewState = useCallback((patch: ArchDiaViewState) => {
        setViewState(prev => ({ ...prev, ...patch }));
    }, []);

    const {
        archDiaFile, scene, content, loading, error,
        updateLayout, updatePositions, updateBends, updateDescriptionsRaw, updateSource, updateRawContent,
        resetLayout, applyPlantUmlLayout, applyTreemapLayout,
    } = draft;

    const handleSizeChange = useCallback((box: ContentBox) => {
        contentBoxRef.current = box;
    }, []);

    const handleFitToContent = useCallback(() => {
        if (!contentBoxRef.current || !archDiaFile) return;
        updateLayout(fitToContent(archDiaFile, contentBoxRef.current).layout);
    }, [archDiaFile, updateLayout]);

    const handleNormalizePositions = useCallback(() => {
        if (!archDiaFile) return;
        const newFile = normalizePositions(archDiaFile, scene);
        if (newFile !== archDiaFile) updateLayout(newFile.layout);
    }, [archDiaFile, scene, updateLayout]);

    // Scoped to the dialog: the preview underneath renders the same diagram.
    const handleExportSVG = useCallback(() => {
        const svgElement = bodyRef.current?.querySelector('.archdia-svg');
        if (!svgElement) return;
        downloadFile(serializeSvgForExport(svgElement), 'diagram.svg');
    }, []);

    // Bridge host app CSS vars to archdia CSS vars
    const hostBridge = {
        [ARCHDIA_CSS_VARS.accentBg]: 'var(--accent-bg)',
        [ARCHDIA_CSS_VARS.text]: 'var(--text)',
        [ARCHDIA_CSS_VARS.border]: 'var(--border)',
        [ARCHDIA_CSS_VARS.muted]: 'var(--muted)',
        [ARCHDIA_CSS_VARS.link]: 'var(--link)',
        height: '100%',
    } as React.CSSProperties;

    return (
        <Modal
            title={convertingFrom ? `Edit diagram — converting from ${convertingFrom}` : 'Edit diagram'}
            open={block !== null}
            onOk={() => onConfirm(content)}
            onCancel={onCancel}
            okText={convertingFrom ? 'Convert & apply' : 'Apply'}
            okButtonProps={{ disabled: !archDiaFile }}
            width="90vw"
            style={{ top: '5vh' }}
            styles={{ body: { height: 'calc(90vh - 110px)', display: 'flex', flexDirection: 'column' } }}
            destroyOnHidden
        >
            <div ref={bodyRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                {loading && <div className="archdia-loading">Loading diagram…</div>}
                {error && <Alert type="error" showIcon message={error} />}
                {archDiaFile && (
                    <ArchDiaEditor
                        archDiaFile={archDiaFile}
                        scene={scene}
                        fileContent={content}
                        onFileContentChange={updateRawContent}
                        onPositionsChange={updatePositions}
                        onBendsChange={updateBends}
                        onDescriptionsRawChange={updateDescriptionsRaw}
                        source={getCombinedSource(archDiaFile)}
                        onPasteSource={updateSource}
                        onPasteFileContent={updateRawContent}
                        onRefreshLayout={resetLayout}
                        onPlantUmlLayout={applyPlantUmlLayout}
                        onTreemapLayout={applyTreemapLayout}
                        onExportSVG={handleExportSVG}
                        onFitToContent={handleFitToContent}
                        onNormalizePositions={handleNormalizePositions}
                        diagramSize={archDiaFile.layout.size}
                        onDiagramSizeChange={(size) => updateLayout({ ...archDiaFile.layout, size })}
                        theme={themeMode(theme)}
                        initialViewState={viewState}
                        onViewStateChange={mergeViewState}
                        onSizeChange={handleSizeChange}
                        style={hostBridge}
                    />
                )}
            </div>
        </Modal>
    );
};
