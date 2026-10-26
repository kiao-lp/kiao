import React from 'react';
import { CommandContext, usePluginHotkeys, useCleanSelectionAndPointing, useSelectionContext } from '@cms-core';

import { useMindmapStateContext, useMindmapMode } from '../state';
import { useDeleteElements } from '../hooks/useDeleteElement';

/**
 * Delete, Backspace and Escape: the keys every program puts them on.
 *
 * Escape clears the selection, or steps back to visualising when there is nothing to clear.
 */
export const useCoreHotkeys = () => {
    const [mode, setMode] = useMindmapMode();
    const cleanSelectionAndPointing = useCleanSelectionAndPointing();
    const [, setSelection] = useSelectionContext();
    const { selectElements } = useMindmapStateContext();

    const deleteElements = useDeleteElements();

    // Delete takes the selection, or the pointed element with nothing selected. Ids are read off
    // the key-press context and dropped when they match nothing on the map.
    const namedOnMap = React.useCallback((ctx: CommandContext) => {
        const named = ctx.selection.length > 0
            ? ctx.selection
            : ctx.pointedElement ? [ctx.pointedElement] : [];
        return selectElements(element => named.includes(element.id)).map(element => element.id);
    }, [selectElements]);

    const deleteNamed = React.useCallback((ctx: CommandContext) => {
        deleteElements(namedOnMap(ctx));
        cleanSelectionAndPointing();
    }, [namedOnMap, deleteElements, cleanSelectionAndPointing]);

    usePluginHotkeys('mindmap-editor', [
        {
            id: 'delete-element',
            key: 'Delete',
            title: <>Delete. Delete selected</>,
            enabledWhen: (ctx: CommandContext) => mode === 'EDIT' && namedOnMap(ctx).length > 0,
            execute: deleteNamed
        },
        {
            id: 'delete-element-backspace',
            key: 'Backspace',
            title: <>Backspace. Delete selected</>,
            enabledWhen: (ctx: CommandContext) => mode === 'EDIT' && namedOnMap(ctx).length > 0,
            execute: deleteNamed
        },
        {
            id: 'clear-selection',
            key: 'Escape',
            title: <>Escape. Clear selection</>,
            enabledWhen: () => mode === 'EDIT',
            execute: (ctx: CommandContext) => {
                if (ctx.selection.length > 0) setSelection([]);
                else setMode('VISUALIZE');
            },
        },
    ], [mode, namedOnMap, deleteNamed, setSelection, setMode]);
};
