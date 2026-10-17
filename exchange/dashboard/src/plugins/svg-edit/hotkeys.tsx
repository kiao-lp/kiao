import React, { useCallback } from 'react';
import { Clipboard, CommandContext, usePluginHotkeys, useSelectionContext } from '@cms-core';
import { useSvgStateContext } from './state';
import { useArrowKeyMove } from './hooks/useArrowKeyMove';
import { useDeleteShapes, useDuplicateShapes } from './hooks/useShapes';
import { documentOfDrawing, encodeSvg, pastedShapes } from './svgDocument';
import { idsOf, movedShape, shapesOf, SvgNode, SvgShape } from './model';

/**
 * The canvas's keys: standard bindings with standard modifiers, and nothing typed as
 * words. The shape verbs without a key of their own — duplicate, restack, text size —
 * live in the right-click menu (`components/SvgContextMenu.tsx`) instead; the typed
 * multi-letter shortcuts are deprecated and this plugin registers none.
 */

const shapesOnCanvas = (document: { drawing: { nodes: SvgNode[] } } | null, ids: string[]): SvgShape[] => {
    if (!document) return [];
    const picked = new Set(ids);
    return shapesOf(document.drawing.nodes).filter(shape => picked.has(shape.id));
};

export const useSvgHotkeys = () => {
    useArrowKeyMove();

    const { document, addShapes, saveSvg, mode, restackShapes } = useSvgStateContext();
    const [, setSelection] = useSelectionContext();
    const deleteShapes = useDeleteShapes();
    const duplicateShapes = useDuplicateShapes();

    // Read off the context the key press carries rather than off what this render closed
    // over (see the mindmap's own Delete): the dispatcher builds it in the render that saw
    // the last change, so it cannot be behind the key that reaches it.
    const namedOnCanvas = useCallback((ctx: CommandContext) =>
        shapesOnCanvas(document, ctx.selection.length > 0 ? ctx.selection : []).map(shape => shape.id),
        [document]);

    const copy = useCallback(async (ids: string[]) => {
        const shapes = shapesOnCanvas(document, ids);
        if (shapes.length === 0) return;
        await Clipboard.setClipboard(encodeSvg(documentOfDrawing({ canvas: { width: 800, height: 600 }, nodes: shapes.map(shape => ({ kind: 'shape' as const, shape })) })));
    }, [document]);

    const cut = useCallback(async (ids: string[]) => {
        const shapes = shapesOnCanvas(document, ids);
        if (shapes.length === 0) return;
        await Clipboard.setClipboard(encodeSvg(documentOfDrawing({ canvas: { width: 800, height: 600 }, nodes: shapes.map(shape => ({ kind: 'shape' as const, shape })) })));
        deleteShapes(shapes.map(shape => shape.id));
    }, [document, deleteShapes]);

    const paste = useCallback(async () => {
        if (!document) return;
        const landed = pastedShapes(await Clipboard.getClipboardText(), new Set(idsOf(document.drawing.nodes)));
        if (!landed || landed.length === 0) return;
        const moved = landed.map(shape => movedShape(shape, 20, 20));
        addShapes(moved);
        saveSvg();
        setSelection(moved.map(shape => shape.id));
    }, [document, addShapes, saveSvg, setSelection]);

    usePluginHotkeys('svg-edit', [
        {
            id: 'svg-delete',
            key: 'Delete',
            title: <>Delete. Delete selected</>,
            enabledWhen: (ctx: CommandContext) => mode === 'canvas' && namedOnCanvas(ctx).length > 0,
            execute: (ctx: CommandContext) => { deleteShapes(namedOnCanvas(ctx)); },
        },
        {
            id: 'svg-delete-backspace',
            key: 'Backspace',
            title: <>Backspace. Delete selected</>,
            enabledWhen: (ctx: CommandContext) => mode === 'canvas' && namedOnCanvas(ctx).length > 0,
            execute: (ctx: CommandContext) => { deleteShapes(namedOnCanvas(ctx)); },
        },
        {
            id: 'svg-select-all',
            key: 'Mod+A',
            title: <>Ctrl+A. Select all</>,
            enabledWhen: () => mode === 'canvas' && !!document,
            execute: () => {
                if (document) setSelection(idsOf(document.drawing.nodes));
            },
        },
        {
            id: 'svg-duplicate-hotkey',
            key: 'Mod+D',
            title: <>Ctrl+D. Duplicate selected</>,
            enabledWhen: (ctx: CommandContext) => mode === 'canvas' && namedOnCanvas(ctx).length > 0,
            execute: () => { duplicateShapes(); },
        },
        {
            id: 'svg-bring-to-front',
            key: 'Mod+Shift+F',
            title: <>Ctrl+Shift+F. Bring to front</>,
            enabledWhen: (ctx: CommandContext) => mode === 'canvas' && namedOnCanvas(ctx).length > 0,
            execute: (ctx: CommandContext) => { restackShapes(namedOnCanvas(ctx), 'front'); saveSvg(); },
        },
        {
            id: 'svg-send-to-back',
            key: 'Mod+Shift+B',
            title: <>Ctrl+Shift+B. Send to back</>,
            enabledWhen: (ctx: CommandContext) => mode === 'canvas' && namedOnCanvas(ctx).length > 0,
            execute: (ctx: CommandContext) => { restackShapes(namedOnCanvas(ctx), 'back'); saveSvg(); },
        },
        {
            id: 'svg-copy',
            key: 'Mod+C',
            title: <>Ctrl+C. Copy</>,
            enabledWhen: (ctx: CommandContext) => mode === 'canvas' && namedOnCanvas(ctx).length > 0,
            execute: (ctx: CommandContext) => { void copy(namedOnCanvas(ctx)); },
        },
        {
            id: 'svg-cut',
            key: 'Mod+X',
            title: <>Ctrl+X. Cut</>,
            enabledWhen: (ctx: CommandContext) => mode === 'canvas' && namedOnCanvas(ctx).length > 0,
            execute: (ctx: CommandContext) => { void cut(namedOnCanvas(ctx)); },
        },
        {
            id: 'svg-paste',
            key: 'Mod+V',
            title: <>Ctrl+V. Paste</>,
            enabledWhen: () => mode === 'canvas' && !!document,
            execute: () => { void paste(); },
        },
        {
            id: 'svg-clear-selection',
            key: 'Escape',
            title: <>Escape. Clear selection</>,
            enabledWhen: (ctx: CommandContext) => mode === 'canvas' && ctx.selection.length > 0,
            execute: () => { setSelection([]); },
        },
    ], [mode, document, namedOnCanvas, deleteShapes, duplicateShapes, copy, cut, paste, setSelection, restackShapes, saveSvg]);
};

export const SvgHotkeysProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    useSvgHotkeys();
    return <>{children}</>;
};
