/** Toolbar and zoom, with diagram and file views. */

import React, { useState, useEffect } from 'react';
import { useZoom } from '@kiao-dashboard-kit/diagram-shared';
import { GraphFile } from '../lib/graph-model';
import { GraphSvgRenderer } from './GraphSvgRenderer';
import { GraphToolbar, GraphView } from './GraphToolbar';
import { GraphStyle } from './GraphStyle';
import { GraphCodeEditor } from './GraphCodeEditor';

// Props.

export interface GraphViewState {
    view?: GraphView;
    zoom?: number;
}

export interface GraphEditorProps {
    /** The parsed GraphFile. Null while loading. */
    graph: GraphFile | null;
    /** Serialized JSON content for the raw editor and copy/paste. */
    fileContent: string;
    onFileContentChange?: (content: string) => void;
    /** Via drag. */
    onPositionsChange?: (updates: Record<string, { x: number; y: number }>) => void;
    onTooltipChange?: (nodeId: string, tooltip: string | undefined) => void;
    /** Takes priority over `onTooltipChange`. */
    onNodeChange?: (nodeId: string, patch: { title: string; values?: Record<string, number>; tooltip?: string }) => void;
    onPasteFileContent?: (content: string) => void;
    onExportSVG?: () => void;
    onFitToContent?: () => void;
    /** Shifts all nodes so no x/y is negative. */
    onNormalizePositions?: () => void;
    onRunAlgorithms?: () => void;
    diagramSize?: { width: number; height: number };
    onDiagramSizeChange?: (size: { width: number; height: number }) => void;
    theme?: 'light' | 'dark';
    /** Measured content size from the renderer. */
    onSizeChange?: (size: { width: number; height: number }) => void;
    /** Seeds the view and zoom on mount; the host remembers them per file. */
    initialViewState?: GraphViewState;
    onViewStateChange?: (patch: GraphViewState) => void;
    className?: string;
    style?: React.CSSProperties;
}

// Component.

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
