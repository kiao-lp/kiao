import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
    parseGraphFile,
    GraphSvgRenderer,
    GraphToolbar,
    GraphFile,
    GraphNode,
    serializeSvgForExport,
    downloadFile,
    GraphStyle,
    GRAPH_CSS_VARS,
    getNormalizedPositions,
} from '@cms-kit/graph';
import { themeMode, DEFAULT_KIAO_THEME } from 'kiao-style';
import { ThemeContext, type Theme } from '../../../ThemeContext';

export interface GraphProps {
    children: string;
    theme?: Theme;
}

export const Graph: React.FC<GraphProps> = ({ children, theme }) => {
    const [state, setState] = useState<{ graphFile: GraphFile } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [zoom, setZoom] = useState(1.0);

    const contentSizeRef = useRef<{ width: number; height: number } | null>(null);

    const handleSizeChange = useCallback((newSize: { width: number; height: number }) => {
        contentSizeRef.current = newSize;
    }, []);

    const handleFitToContent = useCallback(() => {
        if (!contentSizeRef.current || !state) return;
        setState(prev => {
            if (!prev) return prev;
            return {
                ...prev,
                graphFile: {
                    ...prev.graphFile,
                    size: contentSizeRef.current!,
                },
            };
        });
    }, [state]);

    const handleNormalizePositions = useCallback(() => {
        if (!state) return;
        const { graphFile } = state;
        const newPositions = getNormalizedPositions(graphFile);
        if (!newPositions) return;

        setState(prev => {
            if (!prev) return prev;
            const newNodes = graphFile.nodes.map((node: GraphNode) => {
                const pos = newPositions[node.id];
                if (pos) return { ...node, x: pos.x, y: pos.y };
                return node;
            });
            return {
                ...prev,
                graphFile: {
                    ...prev.graphFile,
                    nodes: newNodes,
                },
            };
        });
    }, [state]);

    const handleDiagramSizeChange = useCallback((newSize: { width: number; height: number }) => {
        setState(prev => {
            if (!prev) return prev;
            return {
                ...prev,
                graphFile: {
                    ...prev.graphFile,
                    size: newSize,
                },
            };
        });
    }, []);

    useEffect(() => {
        try {
            const file = parseGraphFile(children);
            setState({ graphFile: file });
            setError(null);
        } catch (err: any) {
            setError(err.message || 'Failed to render Graph diagram');
        }
    }, [children]);

    const handleExportSVG = useCallback(() => {
        const svgElement = document.querySelector('.graph-svg');
        if (!svgElement) return;
        const svg = serializeSvgForExport(svgElement);
        downloadFile(svg, 'graph.svg');
    }, []);

    const appTheme = useContext(ThemeContext)?.theme ?? DEFAULT_KIAO_THEME;
    const resolvedTheme = theme ?? appTheme;
    // The renderer and its stylesheet carry a light and a dark palette, and no more:
    // a sober theme is drawn at its own brightness.
    const mode = themeMode(resolvedTheme);

    if (error) {
        return <div className="graph-error" style={{ color: 'red' }}>Error: {error}</div>;
    }

    if (!state) {
        return <div>Loading Graph...</div>;
    }

    const hostBridge = {
        [GRAPH_CSS_VARS.accentBg]: 'var(--accent-bg)',
        [GRAPH_CSS_VARS.text]: 'var(--text)',
        [GRAPH_CSS_VARS.border]: 'var(--border)',
        [GRAPH_CSS_VARS.muted]: 'var(--muted)',
        [GRAPH_CSS_VARS.link]: 'var(--link)',
    } as React.CSSProperties;

    return (
        <div className={`graph-viewer-container ${mode === 'light' ? 'graph-theme-light' : ''}`} style={{ overflowX: 'auto' }}>
            <GraphStyle />
            <div className="graph-viewer-artboard" style={hostBridge}>
                <div style={zoom !== 1.0 ? { transformOrigin: 'top left', transform: `scale(${zoom})` } : undefined}>
                    <GraphSvgRenderer
                        graph={state.graphFile}
                        theme={mode}
                        onSizeChange={handleSizeChange}
                    />
                </div>
                <GraphToolbar
                    fileContent={JSON.stringify(state.graphFile, null, 2)}
                    onExportSVG={handleExportSVG}
                    onFitToContent={handleFitToContent}
                    onNormalizePositions={handleNormalizePositions}
                    zoom={zoom}
                    onZoomChange={setZoom}
                    diagramSize={state.graphFile.size}
                    onDiagramSizeChange={handleDiagramSizeChange}
                />
            </div>
        </div>
    );
};
