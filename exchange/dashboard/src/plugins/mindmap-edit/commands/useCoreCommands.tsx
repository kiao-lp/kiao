import React, { useCallback, useMemo } from 'react';
import { CommandContext, CommandDescriptor, usePluginHotkeys, useCleanSelectionAndPointing, useSingleTargetElement } from '@cms-core';

// State & Models
import { useMindmapStateContext, useMindmapMode } from '../state';
import {
    MindmapText, MindmapRect,
    instanceOfMindmapText, instanceOfMindmapRect, USER_BOUND_AUTO
} from '../model';
import { useDeleteElements } from '../hooks/useDeleteElement';

// === Core Implementation Hooks ===

const useLargerText = () => {
    const { saveMindmap, mapElements } = useMindmapStateContext();
    const targetElement = useSingleTargetElement();

    return useCallback(() => {
        if (targetElement) {
            mapElements((element) => {
                if (element.id !== targetElement) return element;
                const fontSize = (element as MindmapText).fontSize || 20;
                return { ...element, fontSize: fontSize + 2 };
            });
            saveMindmap();
        }
    }, [targetElement, mapElements, saveMindmap]);
}

const useSmallerText = () => {
    const { mapElements, saveMindmap } = useMindmapStateContext();
    const targetElement = useSingleTargetElement();

    return useCallback(() => {
        if (targetElement) {
            mapElements((element) => {
                if (element.id !== targetElement) return element;
                const fontSize = (element as MindmapText).fontSize || 20;
                return { ...element, fontSize: fontSize - 2 };
            });
            saveMindmap();
        }
    }, [targetElement, mapElements, saveMindmap]);
}

// Rectangle sizing step (in grid units)
const SIZE_STEP = 10;

const useWiderRect = () => {
    const { mapElements, saveMindmap, selectElements } = useMindmapStateContext();
    const targetElement = useSingleTargetElement();

    return useCallback(() => {
        if (targetElement) {
            mapElements((element) => {
                if (element.id !== targetElement) return element;
                const rect = element as MindmapRect;
                const [x, y, w, h] = rect.userBounds;
                const currentWidth = w ?? rect.bounds?.[2] ?? 100;
                const newWidth = currentWidth + SIZE_STEP;
                // Keep center in place: shift x left by half the width increase
                return { ...element, userBounds: [x - SIZE_STEP / 2, y, newWidth, h] };
            });
            saveMindmap();
        }
    }, [targetElement, mapElements, saveMindmap]);
}

const useNarrowerRect = () => {
    const { mapElements, saveMindmap } = useMindmapStateContext();
    const targetElement = useSingleTargetElement();

    return useCallback(() => {
        if (targetElement) {
            mapElements((element) => {
                if (element.id !== targetElement) return element;
                const rect = element as MindmapRect;
                const [x, y, w, h] = rect.userBounds;
                const currentWidth = w ?? rect.bounds?.[2] ?? 100;
                const newWidth = Math.max(SIZE_STEP, currentWidth - SIZE_STEP);
                // Keep center in place: shift x right by half the width decrease
                const widthDecrease = currentWidth - newWidth;
                return { ...element, userBounds: [x + widthDecrease / 2, y, newWidth, h] };
            });
            saveMindmap();
        }
    }, [targetElement, mapElements, saveMindmap]);
}

const useTallerRect = () => {
    const { mapElements, saveMindmap } = useMindmapStateContext();
    const targetElement = useSingleTargetElement();

    return useCallback(() => {
        if (targetElement) {
            mapElements((element) => {
                if (element.id !== targetElement) return element;
                const rect = element as MindmapRect;
                const [x, y, w, h] = rect.userBounds;
                const currentHeight = h ?? rect.bounds?.[3] ?? 100;
                const newHeight = currentHeight + SIZE_STEP;
                // Keep center in place: shift y up by half the height increase
                return { ...element, userBounds: [x, y - SIZE_STEP / 2, w, newHeight] };
            });
            saveMindmap();
        }
    }, [targetElement, mapElements, saveMindmap]);
}

const useShorterRect = () => {
    const { mapElements, saveMindmap } = useMindmapStateContext();
    const targetElement = useSingleTargetElement();

    return useCallback(() => {
        if (targetElement) {
            mapElements((element) => {
                if (element.id !== targetElement) return element;
                const rect = element as MindmapRect;
                const [x, y, w, h] = rect.userBounds;
                const currentHeight = h ?? rect.bounds?.[3] ?? 100;
                const newHeight = Math.max(SIZE_STEP, currentHeight - SIZE_STEP);
                // Keep center in place: shift y down by half the height decrease
                const heightDecrease = currentHeight - newHeight;
                return { ...element, userBounds: [x, y + heightDecrease / 2, w, newHeight] };
            });
            saveMindmap();
        }
    }, [targetElement, mapElements, saveMindmap]);
}

const useNaturalSizeRect = () => {
    const { mapElements, saveMindmap } = useMindmapStateContext();
    const targetElement = useSingleTargetElement();

    return useCallback(() => {
        if (targetElement) {
            mapElements((element) => {
                if (element.id !== targetElement) return element;
                const rect = element as MindmapRect;
                const [x, y, w, h] = rect.userBounds;
                const bounds = rect.bounds ?? [x, y, 100, 100];
                // Compute center of current rect
                const currentWidth = w ?? bounds[2];
                const currentHeight = h ?? bounds[3];
                const centerX = x + currentWidth / 2;
                const centerY = y + currentHeight / 2;
                // Natural size dimensions (from bounds)
                const naturalWidth = bounds[2];
                const naturalHeight = bounds[3];
                // New position to keep center
                const newX = centerX - naturalWidth / 2;
                const newY = centerY - naturalHeight / 2;
                return { ...element, userBounds: [newX, newY, USER_BOUND_AUTO, USER_BOUND_AUTO] };
            });
            saveMindmap();
        }
    }, [targetElement, mapElements, saveMindmap]);
}

// === Main Core Commands Hook ===

export const useCoreCommands = () => {
    const [mode, setMode] = useMindmapMode();
    const cleanSelectionAndPointing = useCleanSelectionAndPointing();
    const { selectElements } = useMindmapStateContext();
    const targetElement = useSingleTargetElement();

    // Hooks
    const deleteElements = useDeleteElements();
    const largerText = useLargerText();
    const smallerText = useSmallerText();
    const widerRect = useWiderRect();
    const narrowerRect = useNarrowerRect();
    const tallerRect = useTallerRect();
    const shorterRect = useShorterRect();
    const naturalSizeRect = useNaturalSizeRect();

    // Computed
    const targetMindmapElement = selectElements(element => element.id === targetElement)[0];

    // What the Delete key takes: everything selected — notes and relations together, however they
    // were gathered — or, with nothing selected, the one element the pointer is over, which is how
    // a note is deleted without being picked out first. Named ids that are nothing on the map are
    // dropped, a relation's end being pointed at rather than selected, so the key stays quiet
    // over one; and with nothing left to take, it is not offered at all.
    //
    // Read off the context the key press carries rather than off what this render closed over.
    // A hotkey is registered from an effect, so the descriptor in the registry is the one built
    // before the selection last changed: a Delete pressed straight after a second element was
    // gathered used to take the first alone. The dispatcher hands `execute` a context built in
    // the render that saw the change, which cannot be behind the key that reaches it.
    const namedOnMap = useCallback((ctx: CommandContext) => {
        const named = ctx.selection.length > 0
            ? ctx.selection
            : ctx.pointedElement ? [ctx.pointedElement] : [];
        return selectElements(element => named.includes(element.id)).map(element => element.id);
    }, [selectElements]);

    usePluginHotkeys('mindmap-editor', [
        {
            id: 'delete-element',
            key: 'Delete',
            title: <>Delete. Delete selected</>,
            enabledWhen: (ctx: CommandContext) => mode === 'EDIT' && namedOnMap(ctx).length > 0,
            execute: (ctx: CommandContext) => {
                deleteElements(namedOnMap(ctx));
                cleanSelectionAndPointing();
            }
        }
    ], [mode, namedOnMap, deleteElements, cleanSelectionAndPointing]);

    return useMemo(() => {
        const cmds: CommandDescriptor[] = [];

        cmds.push({
            id: 'stop-edition',
            shortcut: '[ESC]',
            title: <>[ESC] Stop edition</>,
            enabledWhen: () => mode !== 'VISUALIZE' && !targetMindmapElement,
            execute: () => setMode('VISUALIZE')
        });

        cmds.push({
            id: 'edition',
            shortcut: 'ed',
            title: <>ed.Edition </>,
            enabledWhen: () => mode !== 'EDIT' && !targetMindmapElement,
            execute: () => setMode('EDIT')
        });

        cmds.push({
            id: 'larger-text',
            group: 't[l|s]',
            shortcut: 'tl',
            title: <>tl.Text larger</>,
            enabledWhen: () => mode === 'EDIT' && !!targetMindmapElement && instanceOfMindmapText(targetMindmapElement),
            execute: largerText
        });

        cmds.push({
            id: 'smaller-text',
            group: 't[l|s]',
            shortcut: 'ts',
            title: <>ts.Text smaller</>,
            enabledWhen: () => mode === 'EDIT' && !!targetMindmapElement && instanceOfMindmapText(targetMindmapElement),
            execute: smallerText
        });

        // Rectangle sizing commands
        cmds.push({
            id: 'wider-rect',
            group: 'r[w|n|t|s|x]',
            shortcut: 'rw',
            title: <>rw.Rect wider</>,
            enabledWhen: () => mode === 'EDIT' && !!targetMindmapElement && instanceOfMindmapRect(targetMindmapElement),
            execute: widerRect
        });

        cmds.push({
            id: 'narrower-rect',
            group: 'r[w|n|t|s|x]',
            shortcut: 'rn',
            title: <>rn.Rect narrower</>,
            enabledWhen: () => mode === 'EDIT' && !!targetMindmapElement && instanceOfMindmapRect(targetMindmapElement),
            execute: narrowerRect
        });

        cmds.push({
            id: 'taller-rect',
            group: 'r[w|n|t|s|x]',
            shortcut: 'rt',
            title: <>rt.Rect taller</>,
            enabledWhen: () => mode === 'EDIT' && !!targetMindmapElement && instanceOfMindmapRect(targetMindmapElement),
            execute: tallerRect
        });

        cmds.push({
            id: 'shorter-rect',
            group: 'r[w|n|t|s|x]',
            shortcut: 'rs',
            title: <>rs.Rect shorter</>,
            enabledWhen: () => mode === 'EDIT' && !!targetMindmapElement && instanceOfMindmapRect(targetMindmapElement),
            execute: shorterRect
        });

        cmds.push({
            id: 'natural-size-rect',
            group: 'r[w|n|t|s|x]',
            shortcut: 'rx',
            title: <>rx.Rect natural size</>,
            enabledWhen: () => mode === 'EDIT' && !!targetMindmapElement && instanceOfMindmapRect(targetMindmapElement),
            execute: naturalSizeRect
        });

        return cmds;
    }, [
        mode, setMode, largerText, smallerText,
        widerRect, narrowerRect, tallerRect, shorterRect, naturalSizeRect,
        targetMindmapElement
    ]);
};
