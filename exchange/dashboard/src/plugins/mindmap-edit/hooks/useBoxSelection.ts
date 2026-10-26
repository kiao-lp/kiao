import { useCallback, useState, useRef, MouseEvent } from 'react';
import { useMindmapStateContext, useMindmapMode } from '../state';
import { instanceOfMindmapRect, MindmapRect } from '../model';

export interface BoxSelectionState {
    isActive: boolean;
    startPoint: [number, number] | null;
    currentPoint: [number, number] | null;
}

export interface BoxBounds {
    left: number;
    top: number;
    width: number;
    height: number;
}

const getBoxBounds = (start: [number, number], current: [number, number]): BoxBounds => {
    const left = Math.min(start[0], current[0]);
    const top = Math.min(start[1], current[1]);
    const width = Math.abs(current[0] - start[0]);
    const height = Math.abs(current[1] - start[1]);
    return { left, top, width, height };
};

const rectsIntersect = (box: BoxBounds, rect: MindmapRect): boolean => {
    const bounds = rect.bounds ?? rect.userBounds;
    const [x, y, w, h] = bounds;
    const rectRight = x + (w ?? 0);
    const rectBottom = y + (h ?? 0);
    const boxRight = box.left + box.width;
    const boxBottom = box.top + box.height;

    return !(
        box.left > rectRight ||
        boxRight < x ||
        box.top > rectBottom ||
        boxBottom < y
    );
};

export const useBoxSelection = (setSelection: (ids: string[]) => void, zoom: number = 1) => {
    const [state, setState] = useState<BoxSelectionState>({
        isActive: false,
        startPoint: null,
        currentPoint: null,
    });
    const { selectElements } = useMindmapStateContext();
    const [mode] = useMindmapMode();
    const ctrlKeyRef = useRef(false);
    const previousSelectionRef = useRef<string[]>([]);

    const startSelection = useCallback((e: MouseEvent, mindmapRect: DOMRect, currentSelection: string[]) => {
        if (mode !== 'EDIT') return;

        // Adjust for zoom - divide by zoom to get logical coordinates
        const x = (e.clientX - mindmapRect.left + (e.currentTarget as HTMLElement).scrollLeft) / zoom;
        const y = (e.clientY - mindmapRect.top + (e.currentTarget as HTMLElement).scrollTop) / zoom;

        ctrlKeyRef.current = e.ctrlKey || e.metaKey;
        previousSelectionRef.current = currentSelection;

        setState({
            isActive: true,
            startPoint: [x, y],
            currentPoint: [x, y],
        });
    }, [mode, zoom]);

    const updateSelection = useCallback((e: MouseEvent, mindmapRect: DOMRect) => {
        if (!state.isActive || !state.startPoint) return;

        // Adjust for zoom - divide by zoom to get logical coordinates
        const x = (e.clientX - mindmapRect.left + (e.currentTarget as HTMLElement).scrollLeft) / zoom;
        const y = (e.clientY - mindmapRect.top + (e.currentTarget as HTMLElement).scrollTop) / zoom;

        setState(prev => ({
            ...prev,
            currentPoint: [x, y],
        }));

        // Calculate intersecting elements
        const box = getBoxBounds(state.startPoint, [x, y]);

        const intersectingElements = selectElements((element) => {
            if (!instanceOfMindmapRect(element)) return false;
            return rectsIntersect(box, element as MindmapRect);
        });

        const intersectingIds = intersectingElements.map(e => e.id);

        if (ctrlKeyRef.current) {
            // Add to previous selection
            const combined = Array.from(new Set([...previousSelectionRef.current, ...intersectingIds]));
            setSelection(combined);
        } else {
            setSelection(intersectingIds);
        }
    }, [state.isActive, state.startPoint, selectElements, setSelection, zoom]);

    const endSelection = useCallback(() => {
        setState({
            isActive: false,
            startPoint: null,
            currentPoint: null,
        });
    }, []);

    const boxBounds = state.isActive && state.startPoint && state.currentPoint
        ? getBoxBounds(state.startPoint, state.currentPoint)
        : null;

    return {
        isActive: state.isActive,
        boxBounds,
        startSelection,
        updateSelection,
        endSelection,
    };
};
