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
import { useTheme } from '@cms-core';
import { useArchDiaDraft } from './useArchDiaDraft';

export interface ArchDiaBlockModalProps {
    block: EditableBlock | null;
    onCancel: () => void;
    onConfirm: (body: string) => void;
}

/** Edits are draft-only; the host gets the new body once on validation. Converting a `plantuml`/`mermaid` block is one-way. */
export const ArchDiaBlockModal: React.FC<ArchDiaBlockModalProps> = ({ block, onCancel, onConfirm }) => {
    const { theme } = useTheme();
    const draft = useArchDiaDraft(block?.code ?? null, block?.language);
    const convertingFrom = block && block.language !== 'archdia' ? block.language : null;
    const bodyRef = useRef<HTMLDivElement>(null);
    const contentBoxRef = useRef<ContentBox | null>(null);

    // Per-diagram view state; not shared between diagrams.
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
