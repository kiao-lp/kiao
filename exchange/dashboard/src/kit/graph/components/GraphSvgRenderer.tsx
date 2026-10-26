/**
 * SVG renderer for graph diagrams.
 *
 * Renders nodes as rounded rectangles with title + optional value,
 * and directed edges as lines/curves with arrowheads and optional labels.
 *
 * Supports drag-to-reposition and click-to-edit descriptions.
 */

import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import {
    BOX_FONT_SIZE, BOX_RADIUS, EDGE_LABEL_FONT_SIZE as SHARED_EDGE_LABEL_FONT_SIZE,
    clientToSvg,
    computeEdgePath,
    groupEdgesByPair,
    markdownToHtml,
    EdgeEndpoint,
} from '@cms-kit/diagram-shared';
import { GraphFile, GraphEdge } from '../lib/graph-model';
import { estimateNodeWidth, getNodeHeight } from '../lib/graph-sizing';

// === Constants ===

const BOX_RX = BOX_RADIUS;
const TITLE_FONT_SIZE = BOX_FONT_SIZE;
const VALUE_FONT_SIZE = SHARED_EDGE_LABEL_FONT_SIZE;
const EDGE_LABEL_FONT_SIZE = SHARED_EDGE_LABEL_FONT_SIZE;
const CONTENT_PADDING = 40;

// === Drag State ===

interface DragState {
    nodeId: string;
    startMouseX: number;
    startMouseY: number;
    startElemX: number;
    startElemY: number;
}

// === Component ===

export interface GraphSvgRendererProps {
    /** The full graph file. */
    graph: GraphFile;
    /** Called when one or more nodes are dragged to new positions. */
    onPositionsChange?: (updates: Record<string, { x: number; y: number }>) => void;
    /** Called when a node tooltip changes. If provided, enables click-to-edit. */
    onTooltipChange?: (nodeId: string, tooltip: string | undefined) => void;
    /** Called when a node's title, values, or tooltip change via the editor popup. Takes priority over onTooltipChange. */
    onNodeChange?: (nodeId: string, patch: { title: string; values?: Record<string, number>; tooltip?: string }) => void;
    /** Theme: 'light' or 'dark'. */
    theme?: 'light' | 'dark';
    /** Called when the ideal content-fitting size changes. */
    onSizeChange?: (size: { width: number; height: number }) => void;
}

/** Escape a value for use inside a CSS attribute selector string. */
function cssSafeAttr(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

interface TooltipItem {
    id: string;
    description: string;
    x: number;
    y: number;
    isOnRight?: boolean;
}

// === Content Bounds ===

export function computeGraphContentBounds(
    graph: GraphFile,
): { width: number; height: number } | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const node of graph.nodes) {
        const w = estimateNodeWidth(node.title, node.values);
        const h = getNodeHeight(node.values);
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x + w);
        maxY = Math.max(maxY, node.y + h);
    }

    if (minX === Infinity) return null;
    return {
        width: Math.round((maxX - minX) + CONTENT_PADDING * 2),
        height: Math.round((maxY - minY) + CONTENT_PADDING * 2),
    };
}

export function getNormalizedPositions(
    graph: GraphFile,
): Record<string, { x: number; y: number }> | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const node of graph.nodes) {
        const w = estimateNodeWidth(node.title, node.values);
        const h = getNodeHeight(node.values);
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x + w);
        maxY = Math.max(maxY, node.y + h);
    }

    if (minX === Infinity) return null;

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    let shiftX = -minX;
    let shiftY = -minY;

    if (contentWidth < graph.size.width) {
        shiftX = -minX + (graph.size.width - contentWidth) / 2;
    }
    if (contentHeight < graph.size.height) {
        shiftY = -minY + (graph.size.height - contentHeight) / 2;
    }

    const updates: Record<string, { x: number; y: number }> = {};
    for (const node of graph.nodes) {
        updates[node.id] = {
            x: Math.round(node.x + shiftX),
            y: Math.round(node.y + shiftY),
        };
    }
    return updates;
}

// === Renderer ===

/** Serialize values map to "key: val, key: val" string. */
function valuesToStr(values?: Record<string, number>): string {
    if (!values) return '';
    return Object.entries(values).map(([k, v]) => `${k}: ${v}`).join(', ');
}

/** Parse "key: val, key: val" string to values map. */
function strToValues(str: string): Record<string, number> | undefined {
    if (!str.trim()) return undefined;
    const result: Record<string, number> = {};
    for (const part of str.split(',')) {
        const colonIdx = part.indexOf(':');
        if (colonIdx < 0) continue;
        const key = part.slice(0, colonIdx).trim();
        const val = parseFloat(part.slice(colonIdx + 1).trim());
        if (key && !isNaN(val)) result[key] = val;
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

export const GraphSvgRenderer: React.FC<GraphSvgRendererProps> = ({
    graph,
    onPositionsChange,
    onTooltipChange,
    onNodeChange,
    theme,
    onSizeChange,
}) => {
    const { size, nodes, edges, legend } = graph;
    const svgRef = useRef<SVGSVGElement>(null);
    const [drag, setDrag] = useState<DragState | null>(null);
    const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

    // --- Editor State ---
    const [editorNodeId, setEditorNodeId] = useState<string | null>(null);
    const [editorValue, setEditorValue] = useState<string>('');
    const [editorTitle, setEditorTitle] = useState<string>('');
    const [editorValuesStr, setEditorValuesStr] = useState<string>('');
    const [editorPos, setEditorPos] = useState<{ x: number; y: number } | null>(null);

    // --- Build positions map with drag offset ---
    const effectivePositions = useMemo(() => {
        const positions: Record<string, { x: number; y: number }> = {};
        for (const node of nodes) {
            if (drag && node.id === drag.nodeId) {
                positions[node.id] = { x: node.x + dragOffset.dx, y: node.y + dragOffset.dy };
            } else {
                positions[node.id] = { x: node.x, y: node.y };
            }
        }
        return positions;
    }, [nodes, drag, dragOffset]);

    // --- Node sizes lookup ---
    const nodeSizes = useMemo(() => {
        const sizes: Record<string, { w: number; h: number }> = {};
        for (const node of nodes) {
            sizes[node.id] = {
                w: estimateNodeWidth(node.title, node.values),
                h: getNodeHeight(node.values),
            };
        }
        return sizes;
    }, [nodes]);

    // --- Drag handlers ---
    const handleMouseDown = useCallback((nodeId: string, e: React.MouseEvent) => {
        if (!onPositionsChange && !onTooltipChange) return;
        e.preventDefault();
        e.stopPropagation();
        const svg = svgRef.current;
        if (!svg) return;
        const node = nodes.find(n => n.id === nodeId);
        if (!node) return;
        const { x, y } = clientToSvg(svg, e.clientX, e.clientY);
        setDrag({ nodeId, startMouseX: x, startMouseY: y, startElemX: node.x, startElemY: node.y });
        setDragOffset({ dx: 0, dy: 0 });
    }, [onPositionsChange, onTooltipChange, nodes]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!drag) return;
        e.preventDefault();
        const svg = svgRef.current;
        if (!svg) return;
        const { x, y } = clientToSvg(svg, e.clientX, e.clientY);
        setDragOffset({ dx: x - drag.startMouseX, dy: y - drag.startMouseY });
    }, [drag]);

    const handleMouseUpNode = useCallback((nodeId: string, e: React.MouseEvent) => {
        if (!drag) return;
        e.stopPropagation();

        const isClick = Math.abs(dragOffset.dx) < 5 && Math.abs(dragOffset.dy) < 5;

        if (isClick && (onTooltipChange || onNodeChange)) {
            const node = nodes.find(n => n.id === nodeId);
            const pos = effectivePositions[nodeId];
            const sz = nodeSizes[nodeId];
            if (pos && sz) {
                const isOnRight = (pos.x + sz.w / 2) > size.width / 2;
                const editX = isOnRight ? pos.x + sz.w - 320 - 10 : pos.x + 10;
                setEditorPos({ x: editX, y: pos.y + 10 });
                setEditorNodeId(nodeId);
                setEditorValue(node?.tooltip || '');
                setEditorTitle(node?.title || '');
                setEditorValuesStr(valuesToStr(node?.values));
            }
            setDrag(null);
            setDragOffset({ dx: 0, dy: 0 });
            return;
        }

        handleMouseUp();
    }, [drag, dragOffset, onTooltipChange, onNodeChange, effectivePositions, nodeSizes, size.width, nodes]);

    const handleMouseUp = useCallback(() => {
        if (!drag || !onPositionsChange) return;
        if (Math.abs(dragOffset.dx) >= 1 || Math.abs(dragOffset.dy) >= 1) {
            onPositionsChange({
                [drag.nodeId]: {
                    x: Math.round(drag.startElemX + dragOffset.dx),
                    y: Math.round(drag.startElemY + dragOffset.dy),
                },
            });
        }
        setDrag(null);
        setDragOffset({ dx: 0, dy: 0 });
    }, [drag, dragOffset, onPositionsChange]);

    const handleMouseLeave = useCallback(() => {
        if (drag) handleMouseUp();
    }, [drag, handleMouseUp]);

    // --- Content bounds ---
    const contentBounds = useMemo(() => computeGraphContentBounds(graph), [graph]);

    const lastReportedSize = useRef<string>('');
    useEffect(() => {
        if (!onSizeChange || !contentBounds) return;
        const key = `${contentBounds.width}:${contentBounds.height}`;
        if (key !== lastReportedSize.current) {
            lastReportedSize.current = key;
            onSizeChange({ width: contentBounds.width, height: contentBounds.height });
        }
    }, [contentBounds, onSizeChange]);

    // --- Edge grouping ---
    const edgeGroups = useMemo(() => groupEdgesByPair(edges), [edges]);

    // --- Tooltip items ---
    const tooltipItems = useMemo((): TooltipItem[] => {
        const items: TooltipItem[] = [];
        for (const node of nodes) {
            if (!node.tooltip) continue;
            const pos = effectivePositions[node.id];
            const sz = nodeSizes[node.id];
            if (pos && sz) {
                const isOnRight = (pos.x + sz.w / 2) > size.width / 2;
                items.push({ id: node.id, description: node.tooltip, x: isOnRight ? pos.x - 320 : pos.x + sz.w, y: pos.y, isOnRight });
            }
        }
        return items;
    }, [nodes, effectivePositions, nodeSizes, size.width]);

    // --- Editor commit ---
    const commitEditor = useCallback(() => {
        if (editorNodeId) {
            if (onNodeChange) {
                const tooltip = editorValue.trim() || undefined;
                const values = strToValues(editorValuesStr);
                const title = editorTitle.trim() || nodes.find(n => n.id === editorNodeId)?.title || editorNodeId;
                onNodeChange(editorNodeId, { title, values, tooltip });
            } else if (onTooltipChange) {
                const trimmed = editorValue.trim();
                onTooltipChange(editorNodeId, trimmed || undefined);
            }
        }
        setEditorNodeId(null);
    }, [editorNodeId, editorValue, editorTitle, editorValuesStr, onNodeChange, onTooltipChange, nodes]);

    const handleBackgroundMouseDown = () => {
        if (editorNodeId) commitEditor();
    };

    const viewBoxAttr = `0 0 ${size.width} ${size.height}`;
    const isDraggable = !!onPositionsChange;
    const isEditable = !!onTooltipChange || !!onNodeChange;
    const isDragging = !!drag;

    return (
        <svg
            ref={svgRef}
            xmlns="http://www.w3.org/2000/svg"
            viewBox={viewBoxAttr}
            width={size.width}
            height={size.height}
            className={`graph-svg${isDragging ? ' graph-dragging' : ''}${editorNodeId ? ' graph-editing' : ''}${theme === 'light' ? ' graph-theme-light' : ''}`}
            onMouseMove={isDragging ? handleMouseMove : undefined}
            onMouseUp={isDragging ? handleMouseUp : undefined}
            onMouseLeave={isDragging ? handleMouseLeave : undefined}
            onMouseDown={handleBackgroundMouseDown}
        >
            {/* Arrowhead marker */}
            <defs>
                <marker
                    id="graph-arrowhead"
                    markerWidth="10"
                    markerHeight="7"
                    refX="10"
                    refY="3.5"
                    orient="auto"
                >
                    <polygon
                        points="0 0, 10 3.5, 0 7"
                        fill="currentColor"
                        className="graph-arrowhead"
                    />
                </marker>
            </defs>

            {/* Layer 1: Edges */}
            {Array.from(edgeGroups.values()).flatMap(groupEdges =>
                groupEdges.map((edge: GraphEdge, indexInGroup: number) => {
                    const fromPos = effectivePositions[edge.from];
                    const toPos = effectivePositions[edge.to];
                    if (!fromPos || !toPos) return null;

                    const fromSz = nodeSizes[edge.from];
                    const toSz = nodeSizes[edge.to];
                    if (!fromSz || !toSz) return null;

                    const from: EdgeEndpoint = { ...fromPos, width: fromSz.w, height: fromSz.h };
                    const to: EdgeEndpoint = { ...toPos, width: toSz.w, height: toSz.h };
                    const isSelfLoop = edge.from === edge.to;

                    const { d, labelX, labelY } = computeEdgePath(
                        from, to,
                        indexInGroup, groupEdges.length,
                        isSelfLoop,
                        edge.from, edge.to,
                    );

                    return (
                        <g key={`edge-${edge.from}-${edge.to}-${indexInGroup}`} className="graph-edge">
                            <path
                                d={d}
                                className="graph-edge-line"
                                markerEnd="url(#graph-arrowhead)"
                                fill="none"
                            />
                            {edge.values && Object.keys(edge.values).length > 0 && (
                                <text
                                    x={labelX}
                                    y={labelY}
                                    textAnchor="middle"
                                    fontSize={EDGE_LABEL_FONT_SIZE}
                                    className="graph-edge-label"
                                >
                                    {Object.entries(edge.values).map(([key, val], i) => (
                                        <React.Fragment key={key}>
                                            {i > 0 && <tspan>{' | '}</tspan>}
                                            <tspan style={legend?.[key] ? { fill: legend[key] } : undefined}>{val}</tspan>
                                        </React.Fragment>
                                    ))}
                                </text>
                            )}
                        </g>
                    );
                }),
            )}

            {/* Layer 2: Nodes */}
            {nodes.map(node => {
                const pos = effectivePositions[node.id];
                if (!pos) return null;
                const sz = nodeSizes[node.id];
                if (!sz) return null;
                const cx = pos.x + sz.w / 2;
                const hasValues = node.values && Object.keys(node.values).length > 0;

                return (
                    <g
                        key={node.id}
                        className={`graph-node${isDraggable ? ' graph-draggable' : ''}${isEditable ? ' graph-editable' : ''}`}
                        data-graph-id={node.tooltip ? node.id : undefined}
                        onMouseDown={isDraggable || isEditable ? (e) => handleMouseDown(node.id, e) : undefined}
                        onMouseUp={isDraggable || isEditable ? (e) => handleMouseUpNode(node.id, e) : undefined}
                    >
                        {/* Hit area */}
                        <rect x={pos.x} y={pos.y} width={sz.w} height={sz.h} fill="transparent" />

                        {/* Box */}
                        <rect
                            x={pos.x}
                            y={pos.y}
                            width={sz.w}
                            height={sz.h}
                            rx={BOX_RX}
                            ry={BOX_RX}
                            className="graph-node-box"
                            style={node.color ? { fill: node.color } : undefined}
                        />

                        {/* Title */}
                        <text
                            x={cx}
                            y={hasValues ? pos.y + sz.h / 2 - 8 : pos.y + sz.h / 2}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fontSize={TITLE_FONT_SIZE}
                            fontWeight="bold"
                            className="graph-node-label"
                        >
                            {node.title}
                        </text>

                        {/* Values */}
                        {hasValues && (
                            <text
                                x={cx}
                                y={pos.y + sz.h / 2 + 10}
                                textAnchor="middle"
                                dominantBaseline="central"
                                fontSize={VALUE_FONT_SIZE}
                                className="graph-node-value"
                            >
                                {Object.entries(node.values!).map(([key, val], i) => (
                                    <React.Fragment key={key}>
                                        {i > 0 && <tspan>{' | '}</tspan>}
                                        <tspan style={legend?.[key] ? { fill: legend[key] } : undefined}>{val}</tspan>
                                    </React.Fragment>
                                ))}
                            </text>
                        )}
                    </g>
                );
            })}

            {/* Layer 3: Inline tooltips */}
            {tooltipItems.length > 0 && (() => {
                const css = tooltipItems
                    .map(item => `svg:not(.graph-dragging):not(.graph-editing):has([data-graph-id="${cssSafeAttr(item.id)}"]:hover) [data-graph-tip="${cssSafeAttr(item.id)}"] { display: block; }`)
                    .join('\n');
                return (
                    <>
                        <style>{css}</style>
                        {tooltipItems.map(item => (
                            <foreignObject
                                key={`tooltip-${item.id}`}
                                x={item.x}
                                y={item.y}
                                width={320}
                                height={1}
                                className="graph-inline-tooltip"
                                data-graph-tip={item.id}
                                style={{ overflow: 'visible', pointerEvents: 'none' }}
                            >
                                <div style={{ display: 'flex', justifyContent: item.isOnRight ? 'flex-end' : 'flex-start' }}>
                                    <div
                                        className="graph-tooltip-body"
                                        dangerouslySetInnerHTML={{ __html: markdownToHtml(item.description) }}
                                    />
                                </div>
                            </foreignObject>
                        ))}
                    </>
                );
            })()}

            {/* Layer 4: Floating Editor */}
            {editorNodeId && editorPos && (
                <foreignObject
                    x={editorPos.x}
                    y={editorPos.y}
                    width={320}
                    height={260}
                    style={{ overflow: 'visible' }}
                >
                    <div
                        className="graph-description-editor-container"
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <input
                            className="graph-description-editor-input"
                            value={editorTitle}
                            onChange={(e) => setEditorTitle(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') commitEditor(); }}
                            autoFocus
                            placeholder="Node name..."
                        />
                        <input
                            className="graph-description-editor-input"
                            value={editorValuesStr}
                            onChange={(e) => setEditorValuesStr(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') commitEditor(); }}
                            placeholder="Values: key: num, key: num..."
                        />
                        <textarea
                            className="graph-description-editor-textarea"
                            value={editorValue}
                            onChange={(e) => setEditorValue(e.target.value)}
                            onBlur={commitEditor}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') commitEditor();
                            }}
                            placeholder="Add markdown description for tooltip..."
                        />
                    </div>
                </foreignObject>
            )}
        </svg>
    );
};
