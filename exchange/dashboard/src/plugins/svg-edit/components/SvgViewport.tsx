import React, { MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelectionContext } from '@cms-core';
import { boxOfShape, useSvgStateContext } from '../state';
import {
    bboxOfShape, Box, boxOfCorners, boxesIntersect, isResizable, shapeById, shapesOf,
    shapeWithBox, SvgCanvas, SvgShape,
} from '../model';
import { reactPropsOf, styleObjectOf, SvgShapeView } from './SvgShapeView';
import { SvgContextMenu, SvgMenuAnchor } from './SvgContextMenu';
import { useMoveSelection } from '../hooks/useMoveSelection';
import { useWheelZoom } from '../hooks/useWheelZoom';
import { useCreateShape } from '../hooks/useShapes';

type HandleKind = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

type Gesture =
    | { kind: 'drag'; last: [number, number]; downAt: [number, number]; moved: boolean }
    | { kind: 'resize'; id: string; handle: HandleKind; start: Box }
    | { kind: 'box'; start: [number, number]; additive: boolean; previous: string[] };

/**
 * A client point in the drawing's own units. The authoritative path goes through the
 * screen CTM, so it holds whatever the `viewBox` and the zoom make of the canvas; the
 * fallback maps through the bounding rect for the environments without one (tests).
 */
export const svgPointOf = (
    svg: SVGSVGElement | null, clientX: number, clientY: number, canvas: SvgCanvas,
): [number, number] | null => {
    if (!svg) return null;
    try {
        const ctm = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
        if (ctm) {
            const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
            return [pt.x, pt.y];
        }
    } catch {
        // Below.
    }
    const rect = typeof svg.getBoundingClientRect === 'function' ? svg.getBoundingClientRect() : null;
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return [
        ((clientX - rect.left) / rect.width) * canvas.width,
        ((clientY - rect.top) / rect.height) * canvas.height,
    ];
};

/** The box a resize handle drag says the shape now covers: the opposite edge stays put. */
export const resizedBox = (start: Box, handle: HandleKind, at: [number, number]): Box => {
    const right = start.x + start.width;
    const bottom = start.y + start.height;
    let x = start.x;
    let y = start.y;
    let width = start.width;
    let height = start.height;
    if (handle.includes('e')) width = at[0] - start.x;
    if (handle.includes('s')) height = at[1] - start.y;
    if (handle.includes('w')) {
        x = Math.min(at[0], right - 1);
        width = right - x;
    }
    if (handle.includes('n')) {
        y = Math.min(at[1], bottom - 1);
        height = bottom - y;
    }
    return { x, y, width: Math.max(1, width), height: Math.max(1, height) };
};

const HANDLE_CURSORS: Record<HandleKind, string> = {
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
};

const HANDLES: HandleKind[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const handleAt = (box: Box, handle: HandleKind): [number, number] => {
    const x = handle.includes('w') ? box.x : handle.includes('e') ? box.x + box.width : box.x + box.width / 2;
    const y = handle.includes('n') ? box.y : handle.includes('s') ? box.y + box.height : box.y + box.height / 2;
    return [x, y];
};

export const SvgViewport: React.FC = () => {
    const {
        document, patchShape, saveSvg, measured, zoom, setZoom,
    } = useSvgStateContext();
    const [selection, setSelection] = useSelectionContext();
    const moveSelection = useMoveSelection();
    const createShape = useCreateShape();

    const divRef = useRef<HTMLDivElement | null>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);
    useWheelZoom(divRef, zoom, setZoom);

    const gesture = useRef<Gesture | null>(null);
    const [boxSelect, setBoxSelect] = useState<Box | null>(null);
    const [editingText, setEditingText] = useState<string | null>(null);
    const [menuAnchor, setMenuAnchor] = useState<SvgMenuAnchor | null>(null);

    const canvas = document?.drawing.canvas;
    const pointOf = useCallback((clientX: number, clientY: number): [number, number] | null =>
        canvas ? svgPointOf(svgRef.current, clientX, clientY, canvas) : null,
        [canvas]);

    // Every shape's box — attributes first, the DOM measurement after — for the box
    // selection and the overlays. Read through a ref inside the gesture handlers so a
    // drag never works off a render it has moved past.
    const boxes = useMemo(() => {
        if (!document) return [];
        return shapesOf(document.drawing.nodes).flatMap(shape => {
            const box = boxOfShape(shape, measured);
            return box ? [{ id: shape.id, box }] : [];
        });
    }, [document, measured]);
    const boxesRef = useRef(boxes);
    boxesRef.current = boxes;
    const documentRef = useRef(document);
    documentRef.current = document;

    const endGesture = useCallback(() => {
        const current = gesture.current;
        gesture.current = null;
        setBoxSelect(null);
        if (!current) return;
        if (current.kind === 'drag' && current.moved) saveSvg();
        if (current.kind === 'resize') saveSvg();
    }, [saveSvg]);

    const onWindowMove = useCallback((event: PointerEvent) => {
        const current = gesture.current;
        if (!current) return;
        const at = pointOf(event.clientX, event.clientY);
        if (!at) return;
        if (current.kind === 'drag') {
            if (Math.hypot(event.clientX - current.downAt[0], event.clientY - current.downAt[1]) > 2) {
                current.moved = true;
            }
            if (current.moved) {
                moveSelection(at[0] - current.last[0], at[1] - current.last[1]);
                current.last = at;
            }
        } else if (current.kind === 'resize') {
            const doc = documentRef.current;
            const shape = doc ? shapeById(doc.drawing.nodes, current.id) : undefined;
            if (!shape) return;
            const grown = shapeWithBox(shape, resizedBox(current.start, current.handle, at));
            // Every move has already moved the shape; letting go only puts it on disk.
            if (grown) patchShape(current.id, { attrs: grown.attrs });
        } else {
            const box = boxOfCorners(current.start, at);
            setBoxSelect(box);
            const touched = boxesRef.current.filter(entry => boxesIntersect(box, entry.box)).map(entry => entry.id);
            setSelection(current.additive
                ? Array.from(new Set([...current.previous, ...touched]))
                : touched);
        }
    }, [pointOf, moveSelection, patchShape, setSelection]);

    const onWindowUp = useCallback(() => { endGesture(); }, [endGesture]);

    useEffect(() => {
        window.addEventListener('pointermove', onWindowMove);
        window.addEventListener('pointerup', onWindowUp);
        window.addEventListener('pointercancel', onWindowUp);
        return () => {
            window.removeEventListener('pointermove', onWindowMove);
            window.removeEventListener('pointerup', onWindowUp);
            window.removeEventListener('pointercancel', onWindowUp);
        };
    }, [onWindowMove, onWindowUp]);

    if (!document || !canvas) return null;

    const onCanvasDown = (event: MouseEvent) => {
        if (event.target !== svgRef.current) return;
        if (event.button !== 0) return;
        const at = pointOf(event.clientX, event.clientY);
        if (!at) return;
        const additive = event.ctrlKey || event.metaKey;
        if (!additive) setSelection([]);
        gesture.current = { kind: 'box', start: at, additive, previous: selection };
        setBoxSelect({ x: at[0], y: at[1], width: 0, height: 0 });
    };

    const onShapeDown = (event: React.PointerEvent, id: string) => {
        event.stopPropagation();
        if (event.button !== 0) return;
        const at = pointOf(event.clientX, event.clientY);
        if (!at) return;
        if (event.ctrlKey || event.metaKey) {
            setSelection(previous => previous.includes(id)
                ? previous.filter(named => named !== id)
                : [...previous, id]);
        } else if (!selection.includes(id)) {
            setSelection([id]);
        }
        gesture.current = { kind: 'drag', last: at, downAt: [event.clientX, event.clientY], moved: false };
    };

    const onHandleDown = (event: React.PointerEvent, id: string, handle: HandleKind) => {
        event.stopPropagation();
        event.preventDefault();
        const found = boxesRef.current.find(entry => entry.id === id);
        if (!found) return;
        gesture.current = { kind: 'resize', id, handle, start: found.box };
    };

    // Double clicking the bare canvas drops a new shape over the click — the mindmap's own
    // gesture. Over a shape the double click belongs to that shape, not to the canvas.
    const onCanvasDoubleClick = (event: MouseEvent) => {
        if (event.target !== svgRef.current) return;
        const at = pointOf(event.clientX, event.clientY);
        if (at) createShape(at);
    };

    // A right-click on a shape opens the shape menu over it, picking the shape out
    // first where it is not already among the selection. On the bare canvas the event
    // is left alone, and the browser's own menu opens.
    const onContextMenu = (event: React.MouseEvent) => {
        const target = event.target as Element | null;
        const id = target?.closest?.('[data-shape-id]')?.getAttribute('data-shape-id');
        if (!id) return;
        event.preventDefault();
        if (!selection.includes(id)) setSelection([id]);
        setMenuAnchor({ x: event.clientX, y: event.clientY });
    };

    const picked = new Set(selection);
    const selectedBoxes = boxes.filter(entry => picked.has(entry.id));
    const singleResizable: { shape: SvgShape; box: Box } | null = (() => {
        if (selection.length !== 1) return null;
        const shape = shapeById(document.drawing.nodes, selection[0]);
        const box = selectedBoxes.find(entry => entry.id === selection[0])?.box;
        if (!shape || !box || !isResizable(shape) || !bboxOfShape(shape)) return null;
        return { shape, box };
    })();
    const handleSize = 10 / zoom;

    // The file's own class rides beside the canvas one rather than replacing it, and
    // its inline style arrives parsed: React throws on a string style.
    const { className: rootClass, ...restRootProps } = reactPropsOf(document.rootAttrs);
    const rootStyle = document.rootAttrs.style ? styleObjectOf(document.rootAttrs.style) : undefined;

    return (
        <div
            ref={divRef}
            className="svg-edit"
            onMouseDown={onCanvasDown}
            onDoubleClick={onCanvasDoubleClick}
            onContextMenu={onContextMenu}
            style={{ minWidth: canvas.width * zoom + 48, minHeight: canvas.height * zoom + 48 }}
        >
            <div
                className="svg-zoom-container"
                style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: 'top left',
                    width: `${100 / zoom}%`,
                }}
            >
                <svg
                    ref={svgRef}
                    className={rootClass ? `svg-canvas ${rootClass}` : 'svg-canvas'}
                    style={rootStyle}
                    width={canvas.width}
                    height={canvas.height}
                    {...restRootProps}
                >
                    {document.drawing.nodes.map((node, index) =>
                        node.kind === 'shape' ? (
                            <SvgShapeView
                                key={node.shape.id}
                                shape={node.shape}
                                onShapeDown={onShapeDown}
                                onEditText={setEditingText}
                            />
                        ) : (
                            <g key={`raw-${index}`} dangerouslySetInnerHTML={{ __html: node.xml }} />
                        ),
                    )}
                    {selectedBoxes.map(({ id, box }) => (
                        <rect
                            key={`sel-${id}`}
                            className="svg-selection"
                            x={box.x}
                            y={box.y}
                            width={Math.max(1, box.width)}
                            height={Math.max(1, box.height)}
                            pointerEvents="none"
                        />
                    ))}
                    {singleResizable && HANDLES.map(handle => {
                        const [cx, cy] = handleAt(singleResizable.box, handle);
                        return (
                            <rect
                                key={handle}
                                className="svg-handle"
                                data-shape-id={singleResizable.shape.id}
                                x={cx - handleSize / 2}
                                y={cy - handleSize / 2}
                                width={handleSize}
                                height={handleSize}
                                style={{ cursor: HANDLE_CURSORS[handle] }}
                                onPointerDown={event => onHandleDown(event, singleResizable.shape.id, handle)}
                            />
                        );
                    })}
                    {boxSelect && (
                        <rect
                            className="svg-box-select"
                            x={boxSelect.x}
                            y={boxSelect.y}
                            width={boxSelect.width}
                            height={boxSelect.height}
                            pointerEvents="none"
                        />
                    )}
                </svg>
            </div>
            {editingText && (
                <TextEditorOverlay
                    shapeId={editingText}
                    svgRef={svgRef}
                    containerRef={divRef}
                    onClose={() => setEditingText(null)}
                />
            )}
            {menuAnchor && selection.length > 0 && (
                <SvgContextMenu anchor={menuAnchor} onClose={() => setMenuAnchor(null)} />
            )}
        </div>
    );
};

// === Inline text editing ===

interface TextEditorOverlayProps {
    shapeId: string;
    svgRef: React.RefObject<SVGSVGElement | null>;
    containerRef: React.RefObject<HTMLDivElement | null>;
    onClose: () => void;
}

/**
 * The text a double-clicked `<text>` holds, in a box over the shape itself. Enter puts it
 * back, Escape leaves it as it was, and clicking away puts it back too.
 */
const TextEditorOverlay: React.FC<TextEditorOverlayProps> = ({ shapeId, svgRef, containerRef, onClose }) => {
    const { document, patchShape, saveSvg } = useSvgStateContext();
    const shape = document ? shapeById(document.drawing.nodes, shapeId) : undefined;
    const [value, setValue] = useState(shape?.text ?? '');
    const [frame, setFrame] = useState<{ left: number; top: number; width: number } | null>(null);

    useEffect(() => {
        const element = svgRef.current?.querySelector(`[data-shape-id="${shapeId}"]`);
        const container = containerRef.current;
        if (!element || !container) return;
        const box = element.getBoundingClientRect();
        const outer = container.getBoundingClientRect();
        setFrame({
            left: box.left - outer.left + container.scrollLeft,
            top: box.top - outer.top + container.scrollTop,
            width: Math.max(120, box.width + 24),
        });
    }, [shapeId, svgRef, containerRef]);

    if (!shape || shape.tag !== 'text') return null;

    const commit = () => {
        patchShape(shapeId, { text: value });
        saveSvg();
        onClose();
    };

    return (
        <textarea
            className="svg-text-editor"
            autoFocus
            value={value}
            onChange={event => setValue(event.target.value)}
            onBlur={commit}
            onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    commit();
                }
                if (event.key === 'Escape') onClose();
                event.stopPropagation();
            }}
            onMouseDown={event => event.stopPropagation()}
            onDoubleClick={event => event.stopPropagation()}
            style={frame ? { left: frame.left, top: frame.top, width: frame.width } : { visibility: 'hidden' }}
        />
    );
};
