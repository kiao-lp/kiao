/**
 * Top-level graph editor component.
 *
 * Provides a toolbar, zoom, and two views: diagram (interactive SVG)
 * and file (raw JSON editor).
 */

import React, { useState, useEffect } from 'react';
import { useZoom } from '@cms-kit/diagram-shared';
import { GraphFile } from '../lib/graph-model';
import { GraphSvgRenderer } from './GraphSvgRenderer';
import { GraphToolbar, GraphView } from './GraphToolbar';
import { GraphStyle } from './GraphStyle';
import { GraphCodeEditor } from './GraphCodeEditor';

// ── Props ─────────────────────────────────────────────────────────

/** How the editor was left: which view was showing and at what zoom. */
export interface GraphViewState {
    view?: GraphView;
    zoom?: number;
}

export interface GraphEditorProps {
    /** The parsed GraphFile. Null while loading. */
    graph: GraphFile | null;
    /** Serialized JSON content for the raw editor and copy/paste. */
    fileContent: string;
    /** Called when the raw file content changes (from the code editor). */
    onFileContentChange?: (content: string) => void;
    /** Called when node positions change via drag. */
    onPositionsChange?: (updates: Record<string, { x: number; y: number }>) => void;
    /** Called when a node tooltip changes via the editor popup. */
    onTooltipChange?: (nodeId: string, tooltip: string | undefined) => void;
    /** Called when a node's title, values, or tooltip change via the editor popup. Takes priority over onTooltipChange. */
    onNodeChange?: (nodeId: string, patch: { title: string; values?: Record<string, number>; tooltip?: string }) => void;
    /** Called when user pastes file content from clipboard. */
    onPasteFileContent?: (content: string) => void;
    /** Called to export/download SVG. */
    onExportSVG?: () => void;
    /** Called to fit the diagram size to its content. */
    onFitToContent?: () => void;
    /** Called to shift all nodes so no x/y is negative. */
    onNormalizePositions?: () => void;
    /** Called when the user clicks "Run algorithms". */
    onRunAlgorithms?: () => void;
    /** Current diagram size. */
    diagramSize?: { width: number; height: number };
    /** Called when the user picks a new diagram size. */
    onDiagramSizeChange?: (size: { width: number; height: number }) => void;
    /** Theme for the diagram renderer. */
    theme?: 'light' | 'dark';
    /** Called when the renderer reports its measured content size. */
    onSizeChange?: (size: { width: number; height: number }) => void;
    /** Seeds the view and zoom on mount; the host remembers them per file. */
    initialViewState?: GraphViewState;
    /** Called whenever the view or the zoom changes. */
    onViewStateChange?: (patch: GraphViewState) => void;
    /** Optional CSS class for the outer wrapper. */
    className?: string;
    /** Optional inline style for the outer wrapper. */
    style?: React.CSSProperties;
}

// ── Component ─────────────────────────────────────────────────────

export const GraphEditor: React.FC<GraphEditorProps> = ({
    graph,
    fileContent,
    onFileContentChange,
    onPositionsChange,
    onTooltipChange,
    onNodeChange,
    onPasteFileContent,
    onExportSVG,
    onFitToContent,
    onNormalizePositions,
    onRunAlgorithms,
    diagramSize,
    onDiagramSizeChange,
    theme,
    onSizeChange,
    initialViewState,
    onViewStateChange,
    className,
    style,
}) => {
    const [view, setViewInternal] = useState<GraphView>(initialViewState?.view ?? 'diagram');
    const setView = (next: GraphView) => { setViewInternal(next); onViewStateChange?.({ view: next }); };
    const { zoom, setZoom, canvasRef } = useZoom({
        initial: initialViewState?.zoom,
        onChange: z => onViewStateChange?.({ zoom: z }),
    });
    const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>(theme ?? 'dark');

    useEffect(() => {
        if (theme !== undefined) setCurrentTheme(theme);
    }, [theme]);

    if (!graph) return null;

    return (
        <div
            className={`graph-editor-container${currentTheme === 'light' ? ' graph-theme-light' : ''}${className ? ` ${className}` : ''}`}
            style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', ...style }}
        >
            <GraphStyle />
            <GraphToolbar
                activeView={view}
                onViewChange={setView}
                fileContent={fileContent}
                onPasteFileContent={onPasteFileContent}
                onExportSVG={onExportSVG}
                onFitToContent={onFitToContent}
                onNormalizePositions={onNormalizePositions}
                algorithms={graph.algorithms}
                onRunAlgorithms={onRunAlgorithms}
                zoom={zoom}
                onZoomChange={setZoom}
                diagramSize={diagramSize}
                onDiagramSizeChange={onDiagramSizeChange}
                theme={currentTheme}
                onThemeChange={setCurrentTheme}
            />
            {view === 'diagram' && (
                <div className="graph-canvas" ref={canvasRef}>
                    <div className="graph-zoom-container" style={zoom !== 1.0 ? { transform: `scale(${zoom})`, transformOrigin: 'top left' } : undefined}>
                        <GraphSvgRenderer
                            graph={graph}
                            onPositionsChange={onPositionsChange}
                            onTooltipChange={onTooltipChange}
                            onNodeChange={onNodeChange}
                            theme={currentTheme}
                            onSizeChange={onSizeChange}
                        />
                    </div>
                </div>
            )}
            {view === 'file' && (
                <GraphCodeEditor
                    value={fileContent}
                    onChange={onFileContentChange}
                />
            )}
        </div>
    );
};
