import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { Grid } from 'antd';
import { useGlobalViewState } from 'src/cms-core/view-state/useViewState';
import { useViewStateStore } from 'src/cms-core/view-state/ViewState-ctx';

export type ViewMode = 'details' | 'grid';

const isViewMode = (v: unknown): v is ViewMode => v === 'details' || v === 'grid';

interface ViewModeContextValue {
    getViewMode: (currentPath: string) => ViewMode;
    /** The folder's own setting, or null when it has never been given one. */
    getOverride: (currentPath: string) => ViewMode | null;
    setViewMode: (currentPath: string, mode: ViewMode) => void;
    defaultMode: ViewMode;
    setDefaultMode: (mode: ViewMode) => void;
}

const ViewModeContext = createContext<ViewModeContextValue | null>(null);

export const ViewModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const store = useViewStateStore();
    const [fileBrowser, setFileBrowser] = useGlobalViewState('fileBrowser', { viewMode: 'details' as ViewMode });
    const defaultMode = fileBrowser.viewMode;

    // Overrides are read straight from the store: there is one per folder ever
    // visited, and only the browsed folder's value is ever needed.
    const [overrides, setOverrides] = React.useState<Record<string, ViewMode>>({});

    const setDefaultMode = useCallback((mode: ViewMode) => {
        setFileBrowser({ viewMode: mode });
    }, [setFileBrowser]);

    const readOverride = useCallback((path: string): ViewMode | null => {
        const stored = store.getFolderScope<{ viewMode?: ViewMode }>(path, 'fileBrowser', {}).viewMode;
        return isViewMode(stored) ? stored : null;
    }, [store]);

    const getOverride = useCallback((currentPath: string): ViewMode | null => {
        return overrides[currentPath] ?? readOverride(currentPath);
    }, [overrides, readOverride]);

    const getViewMode = useCallback((currentPath: string): ViewMode => {
        return getOverride(currentPath) ?? defaultMode;
    }, [getOverride, defaultMode]);

    const setViewMode = useCallback((currentPath: string, mode: ViewMode) => {
        store.setFolderScope(currentPath, 'fileBrowser', { viewMode: mode });
        setOverrides(prev => ({ ...prev, [currentPath]: mode }));
    }, [store]);

    const value = useMemo(() => ({
        getViewMode,
        getOverride,
        setViewMode,
        defaultMode,
        setDefaultMode,
    }), [getViewMode, getOverride, setViewMode, defaultMode, setDefaultMode]);

    return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
};

export const useViewMode = (currentPath: string): { mode: ViewMode; setMode: (m: ViewMode) => void } => {
    const ctx = useContext(ViewModeContext);
    const screens = Grid.useBreakpoint();
    if (!ctx) throw new Error('useViewMode must be used within a ViewModeProvider');

    // On small viewports, default to grid when there's no explicit per-folder override.
    const isSmall = !screens.md;
    const resolved = ctx.getOverride(currentPath) ?? (isSmall ? 'grid' : ctx.defaultMode);

    return {
        mode: resolved,
        setMode: (m: ViewMode) => ctx.setViewMode(currentPath, m),
    };
};
