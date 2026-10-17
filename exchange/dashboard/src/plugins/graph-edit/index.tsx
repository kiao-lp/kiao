import React, { useCallback, useEffect, useRef } from 'react';
import { themeMode } from 'kiao-style';
import {
    FileDto,
    CmsPlugin,
    extractFileNameFn,
    FileLabelCmp,
    MainViewCmp,
    LayoutContent,
    TopBanner,
    useDocumentFileSync,
    useFileBrowsingPersistenceContext,
    useFileViewState,
    useTheme,
} from '@cms-core';

import {
    GraphEditor,
    parseGraphFile,
    serializeGraphFile,
    applyPositionUpdates,
    applyNodePatch,
    applyTooltipUpdate,
    runAlgorithms,
    computeGraphContentBounds,
    getNormalizedPositions,
    serializeSvgForExport,
    downloadFile,
    GRAPH_CSS_VARS,
} from '@cms-kit/graph';
import type { GraphViewState } from '@cms-kit/graph';
import { Spin } from 'antd';
import iconImg from './icon.svg';

const extension = '.graph.json';

// === File Label ===

const fileLabelCmp: FileLabelCmp = ({ file }) => {
    const title = extractFileNameFn(extension)(file);
    return <><img src={iconImg} className="file-label-icon" alt={title} style={{ marginRight: 4, height: 16 }} />{title}</>;
};

// === Main View ===

// The bridge between the file's text and the graph: both editing surfaces feed the same hook.
const GRAPH_CODEC = { parse: parseGraphFile, serialize: serializeGraphFile };

const MainView: MainViewCmp = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();
    const { theme } = useTheme();

    // Reading, debounced saving and following the file on disk: the shared hook does it all.
    // The source view edits `text` as typed; the canvas edits the parsed graph.
    const { doc: graphFile, text: rawContent, loading, onDocChange, onTextChange } =
        useDocumentFileSync(currentFile?.path, GRAPH_CODEC);

    const contentSizeRef = useRef<{ width: number; height: number } | null>(null);

    // Diagram-or-source and the zoom belong to the graph being read, not the app.
    const [viewState, setViewState] = useFileViewState<GraphViewState>('graph', {});

    useEffect(() => {
        if (currentFile) document.title = extractFileNameFn(extension)(currentFile);
    }, [currentFile]);

    // Handlers

    const handlePositionsChange = useCallback((updates: Record<string, { x: number; y: number }>) => {
        if (!graphFile) return;
        onDocChange({ ...graphFile, nodes: applyPositionUpdates(graphFile.nodes, updates) });
    }, [graphFile, onDocChange]);

    const handleNodeChange = useCallback((nodeId: string, patch: { title: string; values?: Record<string, number>; tooltip?: string }) => {
        if (!graphFile) return;
        onDocChange({ ...graphFile, nodes: applyNodePatch(graphFile.nodes, nodeId, patch) });
    }, [graphFile, onDocChange]);

    const handleTooltipChange = useCallback((nodeId: string, tooltip: string | undefined) => {
        if (!graphFile) return;
        onDocChange({ ...graphFile, nodes: applyTooltipUpdate(graphFile.nodes, nodeId, tooltip) });
    }, [graphFile, onDocChange]);

    const handleRunAlgorithms = useCallback(() => {
        if (!graphFile) return;
        onDocChange(runAlgorithms(graphFile));
    }, [graphFile, onDocChange]);

    const handleFitToContent = useCallback(() => {
        if (!graphFile) return;
        const bounds = computeGraphContentBounds(graphFile);
        if (!bounds) return;
        onDocChange({ ...graphFile, size: bounds });
    }, [graphFile, onDocChange]);

    const handleNormalizePositions = useCallback(() => {
        if (!graphFile) return;
        const updates = getNormalizedPositions(graphFile);
        if (!updates) return;
        onDocChange({ ...graphFile, nodes: applyPositionUpdates(graphFile.nodes, updates) });
    }, [graphFile, onDocChange]);

    const handleDiagramSizeChange = useCallback((size: { width: number; height: number }) => {
        if (!graphFile) return;
        onDocChange({ ...graphFile, size });
    }, [graphFile, onDocChange]);

    const handleSizeChange = useCallback((size: { width: number; height: number }) => {
        contentSizeRef.current = size;
    }, []);

    const handleExportSVG = useCallback(() => {
        const svgElement = document.querySelector('.graph-svg');
        if (!svgElement) return;
        const svg = serializeSvgForExport(svgElement);
        const fileName = (currentFile ? extractFileNameFn(extension)(currentFile) : 'graph') + '.svg';
        downloadFile(svg, fileName);
    }, [currentFile]);

    // Bridge host CSS vars to graph CSS vars
    const hostBridge = graphFile ? {
        [GRAPH_CSS_VARS.accentBg]: 'var(--accent-bg)',
        [GRAPH_CSS_VARS.text]: 'var(--text)',
        [GRAPH_CSS_VARS.border]: 'var(--border)',
        [GRAPH_CSS_VARS.muted]: 'var(--muted)',
        [GRAPH_CSS_VARS.link]: 'var(--link)',
    } as React.CSSProperties : undefined;

    return (
        <>
            <LayoutContent>
                {loading && (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                        <Spin />
                    </div>
                )}
                {!loading && graphFile && (
                    <GraphEditor
                        graph={graphFile}
                        fileContent={rawContent}
                        onFileContentChange={onTextChange}
                        onPositionsChange={handlePositionsChange}
                        onNodeChange={handleNodeChange}
                        onTooltipChange={handleTooltipChange}
                        onRunAlgorithms={handleRunAlgorithms}
                        onFitToContent={handleFitToContent}
                        onNormalizePositions={handleNormalizePositions}
                        onDiagramSizeChange={handleDiagramSizeChange}
                        onSizeChange={handleSizeChange}
                        onExportSVG={handleExportSVG}
                        onPasteFileContent={onTextChange}
                        diagramSize={graphFile.size}
                        theme={themeMode(theme)}
                        initialViewState={viewState}
                        onViewStateChange={setViewState}
                        style={{ ...hostBridge, height: '100%' }}
                    />
                )}
                {!loading && !graphFile && rawContent && (
                    <div style={{ padding: 20, color: 'red' }}>Invalid graph JSON — open in a code editor to fix.</div>
                )}
            </LayoutContent>
            <TopBanner />
        </>
    );
};

// === Export ===

const fileConfigFor = (file: FileDto) => file.path.endsWith(extension) ? {
    fileLabelCmp,
    mainView: MainView,
} : null;

export const plugin: CmsPlugin = {
    id: 'graph-edit',
    fileConfigFor,
    fileExtensions: [extension],
};
