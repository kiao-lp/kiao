import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSelectionContext } from '../../selection';

export type SelectMode = 'replace' | 'toggle';

export interface SelectionModelApi {
    isSelected: (path: string) => boolean;
    primary: string | null;
    selectedCount: number;
    getSelected: () => string[];
    select: (path: string, mode: SelectMode) => void;
    selectRange: (toPath: string, visiblePaths: string[]) => void;
    selectAll: (paths: string[]) => void;
    clear: () => void;
    lastClicked: string | null;
    getVisiblePaths: () => string[];
    setVisiblePaths: (paths: string[]) => void;
    movePrimary: (delta: number, extendRange: boolean) => string | null;
    selectMode: boolean;
    setSelectMode: (on: boolean) => void;
}

const SelectionModelContext = createContext<SelectionModelApi | null>(null);

export const SelectionModelProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [generic, setGeneric] = useSelectionContext();
    const [primaryHint, setPrimaryHint] = useState<string | null>(null);
    const [lastClicked, setLastClickedState] = useState<string | null>(null);
    const [selectMode, setSelectMode] = useState<boolean>(false);
    const visiblePathsRef = useRef<string[]>([]);

    const selectedSet = useMemo(() => new Set(generic), [generic]);

    // Resolve primary from the hint, falling back to last selected if the hint is stale.
    const primary: string | null = useMemo(() => {
        if (primaryHint && selectedSet.has(primaryHint)) return primaryHint;
        if (generic.length > 0) return generic[generic.length - 1];
        return null;
    }, [primaryHint, selectedSet, generic]);

    // Drop a stale primaryHint when the underlying selection changes externally.
    useEffect(() => {
        if (primaryHint && !selectedSet.has(primaryHint)) {
            setPrimaryHint(null);
        }
        if (lastClicked && !selectedSet.has(lastClicked)) {
            setLastClickedState(null);
        }
    }, [selectedSet, primaryHint, lastClicked]);

    const isSelected = useCallback((path: string) => selectedSet.has(path), [selectedSet]);

    const getSelected = useCallback(() => generic.slice(), [generic]);

    const select = useCallback((path: string, mode: SelectMode) => {
        if (mode === 'replace') {
            setGeneric([path]);
            setPrimaryHint(path);
            setLastClickedState(path);
            return;
        }
        setGeneric(prev => {
            const set = new Set(prev);
            if (set.has(path)) set.delete(path);
            else set.add(path);
            return Array.from(set);
        });
        setPrimaryHint(path);
        setLastClickedState(path);
    }, [setGeneric]);

    const selectRange = useCallback((toPath: string, visiblePaths: string[]) => {
        const anchor = lastClicked ?? primary;
        if (!anchor || !visiblePaths.includes(anchor)) {
            select(toPath, 'replace');
            return;
        }
        const a = visiblePaths.indexOf(anchor);
        const b = visiblePaths.indexOf(toPath);
        if (b === -1) return;
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const range = visiblePaths.slice(lo, hi + 1);
        setGeneric(range);
        setPrimaryHint(toPath);
    }, [lastClicked, primary, select, setGeneric]);

    const selectAll = useCallback((paths: string[]) => {
        setGeneric(paths.slice());
        if (paths.length > 0) {
            setPrimaryHint(paths[0]);
            setLastClickedState(paths[0]);
        }
    }, [setGeneric]);

    const clear = useCallback(() => {
        setGeneric([]);
        setPrimaryHint(null);
        setLastClickedState(null);
    }, [setGeneric]);

    const getVisiblePaths = useCallback(() => visiblePathsRef.current, []);
    const setVisiblePaths = useCallback((paths: string[]) => {
        visiblePathsRef.current = paths;
    }, []);

    const movePrimary = useCallback((delta: number, extendRange: boolean): string | null => {
        const visible = visiblePathsRef.current;
        if (visible.length === 0) return null;
        const currentIdx = primary ? visible.indexOf(primary) : -1;
        const nextIdx = currentIdx < 0
            ? (delta > 0 ? 0 : visible.length - 1)
            : Math.max(0, Math.min(visible.length - 1, currentIdx + delta));
        const nextPath = visible[nextIdx];
        if (extendRange) {
            selectRange(nextPath, visible);
        } else {
            setGeneric([nextPath]);
            setPrimaryHint(nextPath);
            setLastClickedState(nextPath);
        }
        return nextPath;
    }, [primary, selectRange, setGeneric]);

    const api: SelectionModelApi = useMemo(() => ({
        isSelected,
        primary,
        selectedCount: selectedSet.size,
        getSelected,
        select,
        selectRange,
        selectAll,
        clear,
        lastClicked,
        getVisiblePaths,
        setVisiblePaths,
        movePrimary,
        selectMode,
        setSelectMode,
    }), [isSelected, primary, selectedSet.size, getSelected, select, selectRange, selectAll, clear, lastClicked, getVisiblePaths, setVisiblePaths, movePrimary, selectMode]);

    return <SelectionModelContext.Provider value={api}>{children}</SelectionModelContext.Provider>;
};

export const useFileSelection = (): SelectionModelApi => {
    const ctx = useContext(SelectionModelContext);
    if (!ctx) throw new Error('useFileSelection must be used within a SelectionModelProvider');
    return ctx;
};

export const useFileSelectionOptional = (): SelectionModelApi | null =>
    useContext(SelectionModelContext);
