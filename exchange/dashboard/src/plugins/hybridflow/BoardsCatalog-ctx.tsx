import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from 'react';
import { useGlobalViewState } from '@kiao-dashboard-core';
import { useHybridflowClient } from './service/HybridflowClient-ctx';
import type { HybridflowClient } from './service/HybridflowClient';
import type { BoardSummary, FolderDto } from './service/types';

interface BoardsCatalog {
    boards: BoardSummary[];
    folders: FolderDto[];
}

interface BoardsCatalogValue {
    client: HybridflowClient | null;
    catalog: BoardsCatalog | null;
    error: string | null;
    loading: boolean;
    reload: () => void;
    connectList: () => () => void;
    showArchived: boolean;
    setShowArchived: (show: boolean) => void;
    expandedFolders: ReadonlySet<string>;
    toggleFolder: (id: string) => void;
    expandFolder: (id: string) => void;
    forgetFolder: (id: string) => void;
}

const BoardsCatalogContext = createContext<BoardsCatalogValue | null>(null);

export const useBoardsCatalog = (): BoardsCatalogValue => {
    const catalog = useContext(BoardsCatalogContext);
    if (!catalog) throw new Error('useBoardsCatalog must be used within a BoardsCatalogProvider');
    return catalog;
};

/** Both boards lists share the same data and expansion state while either list is visible. */
export const BoardsCatalogProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useHybridflowClient();
    const [catalog, setCatalog] = useState<BoardsCatalog | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [showArchived, setShowArchived] = useState(false);
    const [loadVersion, reload] = useReducer((version: number) => version + 1, 0);
    const [listCount, setListCount] = useState(0);
    const hasList = listCount > 0;

    const connectList = useCallback(() => {
        setListCount(count => count + 1);
        return () => setListCount(count => count - 1);
    }, []);

    useEffect(() => {
        if (!client || !hasList) return;
        let active = true;
        setLoading(true);
        void Promise.all([client.boards(showArchived), client.boardFolders()]).then(([boards, folders]) => {
            if (!active) return;
            setCatalog({
                boards: [...boards].sort((a, b) => a.name.localeCompare(b.name)),
                folders: [...folders].sort((a, b) => a.name.localeCompare(b.name)),
            });
            setError(null);
        }).catch(cause => {
            if (active) setError(cause instanceof Error ? cause.message : String(cause));
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, [client, hasList, loadVersion, showArchived]);

    const [expandedIds, setExpandedIds] = useGlobalViewState<string[]>('hybridflowBoardFolders', []);
    const expandedFolders = useMemo(() => new Set(expandedIds), [expandedIds]);
    const toggleFolder = useCallback((id: string) => {
        setExpandedIds(held => held.includes(id) ? held.filter(folder => folder !== id) : [...held, id]);
    }, [setExpandedIds]);
    const expandFolder = useCallback((id: string) => {
        setExpandedIds(held => held.includes(id) ? held : [...held, id]);
    }, [setExpandedIds]);
    const forgetFolder = useCallback((id: string) => {
        setExpandedIds(held => held.filter(folder => folder !== id));
    }, [setExpandedIds]);

    const value = useMemo(() => ({
        client, catalog, error, loading, reload, connectList,
        showArchived, setShowArchived, expandedFolders, toggleFolder, expandFolder, forgetFolder,
    }), [client, catalog, error, loading, reload, connectList, showArchived, expandedFolders, toggleFolder, expandFolder, forgetFolder]);

    return <BoardsCatalogContext.Provider value={value}>{children}</BoardsCatalogContext.Provider>;
};
