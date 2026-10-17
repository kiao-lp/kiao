import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSimpleContext } from 'react-concise';
import { useDocumentFileSync, useFileViewState } from '@cms-core';
import { decodeSvg, encodeSvg, SvgDocument } from './svgDocument';
import {
    bboxOfShape, Box, idsOf, mapShapes, restackedShapes, shapesOf, SvgCanvas, SvgShape, withoutShapes,
} from './model';

// === Types ===

export type SvgViewMode = 'canvas' | 'source';

/** The tags the canvas creates — the closed shapes, a line and a text. */
export type NewShapeKind = 'rect' | 'circle' | 'ellipse' | 'line' | 'text';

export interface NewShapeStyle {
    kind: NewShapeKind;
    fill: string;
    stroke: string;
    strokeWidth: number;
}

export const DEFAULT_NEW_SHAPE_STYLE: NewShapeStyle = {
    kind: 'rect',
    fill: '#ffffff',
    stroke: '#595959',
    strokeWidth: 2,
};

export interface SvgStateValue {
    // Persistence
    document: SvgDocument | null;
    setDocument: React.Dispatch<React.SetStateAction<SvgDocument | null>>;
    saveSvg: () => void;
    /** The file's text as the source view shows it, and what it writes back. */
    text: string;
    onTextChange: (text: string) => void;
    loading: boolean;

    // Shape operations
    patchShape: (id: string, patch: Partial<SvgShape>) => void;
    addShapes: (shapes: SvgShape[]) => void;
    deleteShapes: (ids: string[]) => void;
    restackShapes: (ids: string[], to: 'front' | 'back') => void;
    setCanvas: (canvas: SvgCanvas) => void;

    // Measured boxes for what attributes say nothing of (text, path, g) — live, never saved.
    measured: Record<string, Box>;
    reportMeasured: (id: string, box: Box | null) => void;

    // UI state
    mode: SvgViewMode;
    setMode: (mode: SvgViewMode) => void;
    zoom: number;
    setZoom: (zoom: number) => void;
    newShapeStyle: NewShapeStyle;
    patchNewShapeStyle: (patch: Partial<NewShapeStyle>) => void;
}

// === Internal Persistence Hook ===

/**
 * The drawing on screen, and the file under it — the mindmap split: `setDocument` moves
 * what is drawn, `saveSvg` is what the file hears, because a drag moves on every pointer
 * event and writes once, at the end. What arrives from the file is adopted here, told apart
 * from our own writes coming back by identity: `onDocChange` hands the hook the very object
 * we built, so only a document we have not seen before came from the disk.
 */
const SVG_CODEC = { parse: decodeSvg, serialize: encodeSvg };

const useSvgPersistence = (path: string) => {
    const { doc, text: screenText, loading, onDocChange, onTextChange } =
        useDocumentFileSync(path || undefined, SVG_CODEC);

    const [document, setDocumentState] = useState<SvgDocument | null>(null);
    const edited = useRef<SvgDocument | null>(null);
    const seen = useRef<SvgDocument | null>(null);
    const screenRef = useRef(screenText);
    screenRef.current = screenText;

    const adopt = useCallback((doc: SvgDocument | null) => {
        edited.current = doc;
        setDocumentState(doc);
    }, []);

    useEffect(() => {
        if (doc === seen.current) return;
        seen.current = doc;
        adopt(doc);
    }, [doc, adopt]);

    const setDocument = useCallback<React.Dispatch<React.SetStateAction<SvgDocument | null>>>(update => {
        adopt(typeof update === 'function' ? update(edited.current) : update);
    }, [adopt]);

    const saveSvg = useCallback(() => {
        const doc = edited.current;
        if (!doc) return;
        // A save for a drawing the file already holds writes nothing: serializing is stable,
        // so equal texts mean an unchanged drawing.
        if (SVG_CODEC.serialize(doc) === screenRef.current) return;
        seen.current = doc;
        onDocChange(doc);
    }, [onDocChange]);

    return useMemo(() => ({ document, setDocument, saveSvg, text: screenText, loading, onTextChange }),
        [document, setDocument, saveSvg, screenText, loading, onTextChange]);
};

// === State Context Implementation ===

interface SvgStateProps {
    /** The store path of the `.svg` the state is that of. */
    svgId: string;
}

const useSvgState = (props: SvgStateProps): SvgStateValue => {
    const { document, setDocument, saveSvg, text, loading, onTextChange } = useSvgPersistence(props.svgId);
    // Per drawing rather than app-wide: a dense drawing and a small one want different
    // zoom levels, and each is reopened at the one it was left at — as is the look new
    // shapes are made with, a drawing being drawn in one style at a time.
    const [view, setView] = useFileViewState('svg', {
        mode: 'canvas' as SvgViewMode,
        zoom: 1.0,
        newShapeKind: DEFAULT_NEW_SHAPE_STYLE.kind,
        newShapeFill: DEFAULT_NEW_SHAPE_STYLE.fill,
        newShapeStroke: DEFAULT_NEW_SHAPE_STYLE.stroke,
        newShapeStrokeWidth: DEFAULT_NEW_SHAPE_STYLE.strokeWidth,
    });

    const setMode = useCallback((mode: SvgViewMode) => setView({ mode }), [setView]);

    const setZoom = useCallback((zoom: number) => {
        setView({ zoom: Math.max(0.25, Math.min(2.0, zoom)) });
    }, [setView]);

    const newShapeStyle = useMemo<NewShapeStyle>(() => ({
        kind: view.newShapeKind,
        fill: view.newShapeFill,
        stroke: view.newShapeStroke,
        strokeWidth: view.newShapeStrokeWidth,
    }), [view.newShapeKind, view.newShapeFill, view.newShapeStroke, view.newShapeStrokeWidth]);

    const patchNewShapeStyle = useCallback((patch: Partial<NewShapeStyle>) => {
        setView(previous => ({
            newShapeKind: patch.kind ?? previous.newShapeKind,
            newShapeFill: patch.fill ?? previous.newShapeFill,
            newShapeStroke: patch.stroke ?? previous.newShapeStroke,
            newShapeStrokeWidth: patch.strokeWidth ?? previous.newShapeStrokeWidth,
        }));
    }, [setView]);

    const patchShape = useCallback((id: string, patch: Partial<SvgShape>) => {
        setDocument(doc => doc ? {
            ...doc,
            drawing: { ...doc.drawing, nodes: mapShapes(doc.drawing.nodes, shape => shape.id === id ? { ...shape, ...patch } : shape) },
        } : null);
    }, [setDocument]);

    const addShapes = useCallback((shapes: SvgShape[]) => {
        setDocument(doc => doc ? {
            ...doc,
            drawing: { ...doc.drawing, nodes: [...doc.drawing.nodes, ...shapes.map(shape => ({ kind: 'shape' as const, shape }))] },
        } : null);
    }, [setDocument]);

    const deleteShapes = useCallback((ids: string[]) => {
        if (ids.length === 0) return;
        setDocument(doc => doc ? {
            ...doc,
            drawing: { ...doc.drawing, nodes: withoutShapes(doc.drawing.nodes, ids) },
        } : null);
    }, [setDocument]);

    const restackShapes = useCallback((ids: string[], to: 'front' | 'back') => {
        setDocument(doc => doc ? {
            ...doc,
            drawing: { ...doc.drawing, nodes: restackedShapes(doc.drawing.nodes, ids, to) },
        } : null);
    }, [setDocument]);

    const setCanvas = useCallback((canvas: SvgCanvas) => {
        setDocument(doc => doc ? { ...doc, drawing: { ...doc.drawing, canvas } } : null);
    }, [setDocument]);

    const [measured, setMeasured] = useState<Record<string, Box>>({});
    const reportMeasured = useCallback((id: string, box: Box | null) => {
        setMeasured(previous => {
            const current = previous[id];
            if (!box) {
                if (!current) return previous;
                const { [id]: _dropped, ...rest } = previous;
                return rest;
            }
            if (current && current.x === box.x && current.y === box.y
                && current.width === box.width && current.height === box.height) return previous;
            return { ...previous, [id]: box };
        });
    }, []);

    // A drawing opened under another path drops its measurements: ids are only unique per file.
    useEffect(() => { setMeasured({}); }, [props.svgId]);

    return useMemo(() => ({
        document, setDocument, saveSvg, text, onTextChange, loading,
        patchShape, addShapes, deleteShapes, restackShapes, setCanvas,
        measured, reportMeasured,
        mode: view.mode, setMode, zoom: view.zoom, setZoom, newShapeStyle, patchNewShapeStyle,
    }), [document, setDocument, saveSvg, text, onTextChange, loading,
        patchShape, addShapes, deleteShapes, restackShapes, setCanvas,
        measured, reportMeasured, view.mode, view.zoom, setMode, setZoom, newShapeStyle, patchNewShapeStyle]);
};

const defaultValue: SvgStateValue = {
    document: null,
    setDocument: () => { },
    saveSvg: () => { },
    text: '',
    onTextChange: () => { },
    loading: false,
    patchShape: () => { },
    addShapes: () => { },
    deleteShapes: () => { },
    restackShapes: () => { },
    setCanvas: () => { },
    measured: {},
    reportMeasured: () => { },
    mode: 'canvas',
    setMode: () => { },
    zoom: 1.0,
    setZoom: () => { },
    newShapeStyle: DEFAULT_NEW_SHAPE_STYLE,
    patchNewShapeStyle: () => { },
};

const stateContext = createSimpleContext(useSvgState, defaultValue);

export const useSvgStateContext = stateContext.useContext;

export interface SvgStateProviderProps {
    svgId: string;
    children?: React.ReactNode;
}

export const SvgStateProvider: React.FC<SvgStateProviderProps> = ({ svgId, children }) => (
    <stateContext.Provider svgId={svgId}>
        {children}
    </stateContext.Provider>
);

/** What the box selection and the overlays read: attributes first, the DOM measurement after. */
export const boxOfShape = (shape: SvgShape, measured: Record<string, Box>): Box | null =>
    bboxOfShape(shape) ?? measured[shape.id] ?? null;

export { idsOf, shapesOf };
