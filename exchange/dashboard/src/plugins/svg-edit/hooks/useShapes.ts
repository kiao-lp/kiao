import { useCallback } from 'react';
import { useSelectionContext } from '@cms-core';
import { boxOfShape, useSvgStateContext } from '../state';
import { fmt, grownShape, idsOf, mapShapes, movedShape, numAttr, SvgShape } from '../model';

/** What one Alt+Arrow press grows a shape by, in SVG units. */
export const RESIZE_STEP = 10;
/** What one Alt+Arrow press adds to a text's font, in pixels. */
export const FONT_STEP = 2;

const mintId = (): string =>
    'SHAPE-' + Array.from(crypto.getRandomValues(new Uint8Array(4)))
        .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

const freshIds = (shapes: SvgShape[], taken: Set<string>): SvgShape[] => {
    const fresh = new Set(taken);
    return shapes.map(shape => {
        let id = shape.id;
        while (fresh.has(id)) id = mintId();
        fresh.add(id);
        return { ...shape, id };
    });
};

/** A shape of the style the top bar holds, centred on `at`. */
export const useCreateShape = () => {
    const { document, addShapes, saveSvg, newShapeStyle } = useSvgStateContext();
    const [, setSelection] = useSelectionContext();

    return useCallback((at: [number, number]) => {
        if (!document) return;
        const taken = new Set(idsOf(document.drawing.nodes));
        let id = mintId();
        while (taken.has(id)) id = mintId();
        const { kind, fill, stroke, strokeWidth } = newShapeStyle;
        const [cx, cy] = at;
        const ink = { stroke, 'stroke-width': fmt(strokeWidth) };
        const shape: SvgShape =
            kind === 'rect' ? {
                id, tag: 'rect',
                attrs: { x: fmt(cx - 60), y: fmt(cy - 30), width: '120', height: '60', fill, ...ink },
            } :
                kind === 'circle' ? {
                    id, tag: 'circle', attrs: { cx: fmt(cx), cy: fmt(cy), r: '30', fill, ...ink },
                } :
                    kind === 'ellipse' ? {
                        id, tag: 'ellipse',
                        attrs: { cx: fmt(cx), cy: fmt(cy), rx: '60', ry: '30', fill, ...ink },
                    } :
                        kind === 'line' ? {
                            id, tag: 'line',
                            attrs: { x1: fmt(cx - 60), y1: fmt(cy), x2: fmt(cx + 60), y2: fmt(cy), ...ink },
                        } :
                            {
                                id, tag: 'text', text: 'Text',
                                attrs: { x: fmt(cx), y: fmt(cy), 'font-size': '20', fill: stroke, 'text-anchor': 'middle' },
                            };
        addShapes([shape]);
        saveSvg();
        setSelection([id]);
    }, [document, addShapes, saveSvg, newShapeStyle, setSelection]);
};

/**
 * What is selected, copied beside itself — fresh ids, twenty units down and right — and
 * selected in place of the original, so a second duplicate walks on from the first.
 */
export const useDuplicateShapes = () => {
    const { document, addShapes, saveSvg } = useSvgStateContext();
    const [selection, setSelection] = useSelectionContext();

    return useCallback(() => {
        if (!document || selection.length === 0) return;
        const picked = new Set(selection);
        const copies = freshIds(
            document.drawing.nodes
                .filter((node): node is { kind: 'shape'; shape: SvgShape } => node.kind === 'shape')
                .map(node => node.shape)
                .filter(shape => picked.has(shape.id))
                .map(shape => movedShape(shape, 20, 20)),
            picked);
        if (copies.length === 0) return;
        addShapes(copies);
        saveSvg();
        setSelection(copies.map(shape => shape.id));
    }, [document, addShapes, saveSvg, selection, setSelection]);
};

/**
 * Grows the single selected shape by `(dw, dh)` about its centre — the Alt+Arrow keys.
 * One shape alone: with several picked out, or none, the keys stay quiet.
 */
export const useGrowSelection = () => {
    const { document, setDocument, saveSvg } = useSvgStateContext();
    const [selection] = useSelectionContext();

    return useCallback((dw: number, dh: number) => {
        if (!document || selection.length !== 1) return;
        setDocument(doc => doc ? {
            ...doc,
            drawing: {
                ...doc.drawing,
                nodes: mapShapes(doc.drawing.nodes, shape => {
                    if (shape.id !== selection[0]) return shape;
                    return grownShape(shape, dw, dh) ?? shape;
                }),
            },
        } : null);
        saveSvg();
    }, [document, setDocument, saveSvg, selection]);
};

/**
 * Grows the font of every text selected by `fontDelta` — the Alt+Up/Down keys over a
 * text, the wheel over one, and the context menu. Anything but a text is left alone.
 */
export const useResizeTextSelection = () => {
    const { document, setDocument, saveSvg } = useSvgStateContext();
    const [selection] = useSelectionContext();

    return useCallback((fontDelta: number) => {
        if (!document) return;
        const picked = new Set(selection);
        setDocument(doc => doc ? {
            ...doc,
            drawing: {
                ...doc.drawing,
                nodes: mapShapes(doc.drawing.nodes, shape => {
                    if (!picked.has(shape.id) || shape.tag !== 'text') return shape;
                    const size = Math.max(1, numAttr(shape.attrs, 'font-size', 16) + fontDelta);
                    return { ...shape, attrs: { ...shape.attrs, 'font-size': fmt(size) } };
                }),
            },
        } : null);
        saveSvg();
    }, [document, setDocument, saveSvg, selection]);
};

/** Deletes the named shapes, and drops them from the selection. */
export const useDeleteShapes = () => {
    const { deleteShapes, saveSvg } = useSvgStateContext();
    const [, setSelection] = useSelectionContext();

    return useCallback((ids: string[]) => {
        if (ids.length === 0) return;
        deleteShapes(ids);
        saveSvg();
        setSelection(previous => previous.filter(id => !ids.includes(id)));
    }, [deleteShapes, saveSvg, setSelection]);
};

/**
 * Hand the style the top bar holds to the shapes already drawn and selected. What a shape
 * is given depends on its tag — a text is inked with the stroke colour, a line takes no
 * fill — the same rule a new shape is made under.
 */
export const useApplyStyleToSelection = () => {
    const { document, setDocument, saveSvg, newShapeStyle } = useSvgStateContext();
    const [selection] = useSelectionContext();

    return useCallback(() => {
        if (!document || selection.length === 0) return;
        const picked = new Set(selection);
        const { fill, stroke, strokeWidth } = newShapeStyle;
        setDocument(doc => doc ? {
            ...doc,
            drawing: {
                ...doc.drawing,
                nodes: doc.drawing.nodes.map(node => {
                    if (node.kind !== 'shape' || !picked.has(node.shape.id)) return node;
                    const shape = node.shape;
                    const attrs = { ...shape.attrs };
                    if (shape.tag === 'text') {
                        attrs.fill = stroke;
                    } else if (shape.tag === 'line') {
                        attrs.stroke = stroke;
                        attrs['stroke-width'] = fmt(strokeWidth);
                    } else if (shape.tag === 'path' || shape.tag === 'g') {
                        // Only where the file already said: a path's look is its own.
                        if ('fill' in attrs) attrs.fill = fill;
                        if ('stroke' in attrs) {
                            attrs.stroke = stroke;
                            attrs['stroke-width'] = fmt(strokeWidth);
                        }
                    } else {
                        attrs.fill = fill;
                        attrs.stroke = stroke;
                        attrs['stroke-width'] = fmt(strokeWidth);
                    }
                    return { ...node, shape: { ...shape, attrs } };
                }),
            },
        } : null);
        saveSvg();
    }, [document, setDocument, saveSvg, newShapeStyle, selection]);
};

/** The box each selected shape covers — attributes first, the DOM measurement after. */
export const useSelectionBoxes = (): { id: string; box: import('../model').Box }[] => {
    const { document, measured } = useSvgStateContext();
    const [selection] = useSelectionContext();
    if (!document) return [];
    const picked = new Set(selection);
    return document.drawing.nodes
        .filter((node): node is { kind: 'shape'; shape: SvgShape } => node.kind === 'shape')
        .map(node => node.shape)
        .filter(shape => picked.has(shape.id))
        .flatMap(shape => {
            const box = boxOfShape(shape, measured);
            return box ? [{ id: shape.id, box }] : [];
        });
};
