import { MouseEvent, useCallback, useMemo, useRef } from 'react';
import { createSimpleContext } from 'react-concise';
import { useSelectionContext, useFileBrowsingPersistenceContext } from '@cms-core';

import { useMovementAccumulator } from './MovementAccumulator-ctx';
import { useMindmapMode, useMindmapStateContext } from '../state';
import { useMoveSelection } from '../hooks/useMoveSelection';

const noOperationFn = () => { };

export type MindmapViewportInteractionValue = {
    onMindmapMove: (mouseEvent: MouseEvent) => void;
    onElementDown: () => void;
    onElementUp: () => void;
};

const defaultValue: MindmapViewportInteractionValue = {
    onMindmapMove: noOperationFn,
    onElementDown: noOperationFn,
    onElementUp: noOperationFn
};

const useMindmapViewportInteractionValue = (): MindmapViewportInteractionValue => {
    const [mode, setMode] = useMindmapMode();
    const [selection] = useSelectionContext();
    const { currentFile } = useFileBrowsingPersistenceContext();

    const moveSelection = useMoveSelection();
    const movementAccumulator = useMovementAccumulator(moveSelection);
    const { saveMindmap } = useMindmapStateContext();

    const stateRef = useRef({
        mode,
        selection,
        currentFile,
        saveMindmap,
        setMode
    });

    stateRef.current = {
        mode,
        selection,
        currentFile,
        saveMindmap,
        setMode
    };

    const onMindmapMove = useCallback((mouseEvent: MouseEvent) => {
        movementAccumulator.current.accumulateMovement([mouseEvent.movementX, mouseEvent.movementY]);
    }, [movementAccumulator]);

    const onElementDown = useCallback(() => {
        movementAccumulator.current.start();
        stateRef.current.setMode('EDIT_DRAG');
    }, [movementAccumulator]);


    const onElementUp = useCallback(() => {
        const { mode, selection, saveMindmap, setMode } = stateRef.current;

        if (mode !== 'EDIT_DRAG') {
            return false;
        }

        movementAccumulator.current.stop();

        const hasDragged = movementAccumulator.current.totalDistance >= 2;

        if (hasDragged) {
            saveMindmap();
            setMode('EDIT');
        }

        if (!hasDragged && selection.length === 1) {
            setMode('EDIT_MODIFY_ELEMENT');
        }

        if (!hasDragged && selection.length > 1) {
            setMode('EDIT');
        }
    }, [movementAccumulator]);

    return useMemo(() => ({
        onElementDown,
        onElementUp,
        onMindmapMove
    }), [onElementDown, onElementUp, onMindmapMove]);
};

const hookBasedContext = createSimpleContext(useMindmapViewportInteractionValue, defaultValue);

export const MindmapDragAndDropProvider = hookBasedContext.Provider;
export const useMindmapDragAndDropContext = hookBasedContext.useContext;
