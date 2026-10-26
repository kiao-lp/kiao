import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useHybridflow } from './Hybridflow-ctx';
import { boardTags, filterFlowNodes, keptTags, toggleTag } from './boardFilter';

interface BoardControlsValue {
    zoom: number;
    setZoom: (zoom: number) => void;
    tags: string[];
    filter: string[];
    toggle: (label: string) => void;
    clear: () => void;
    shown: number;
    total: number;
}

const BoardControlsContext = createContext<BoardControlsValue | null>(null);

export const useBoardControls = (): BoardControlsValue => {
    const context = useContext(BoardControlsContext);
    if (!context) throw new Error('useBoardControls must be used within a BoardControlsProvider');
    return context;
};

/**
 * The board's view state: read size and tag filter. Shared by the canvas and the
 * Board tab strip, which render in different bars.
 */
export const BoardControlsProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const { content } = useHybridflow();
    const [zoom, setZoom] = useState(1);
    const [filter, setFilter] = useState<string[]>([]);

    const cards = useMemo(
        () => (content?.flowNodes ?? []).filter(flowNode => !flowNode.archived),
        [content]);
    const classes = useMemo(() => content?.flowNodeClasses ?? [], [content]);
    const tags = useMemo(() => boardTags([...cards, ...classes]), [cards, classes]);
    useEffect(() => setFilter(held => (held.length ? keptTags(held, tags) : held)), [tags]);

    const toggle = useCallback((label: string) => setFilter(held => toggleTag(held, label)), []);
    const clear = useCallback(() => setFilter([]), []);

    const value = useMemo(() => ({
        zoom, setZoom, tags, filter, toggle, clear,
        shown: filterFlowNodes(cards, filter).length + filterFlowNodes(classes, filter).length,
        total: cards.length + classes.length,
    }), [zoom, tags, filter, toggle, clear, cards, classes]);

    return <BoardControlsContext.Provider value={value}>{children}</BoardControlsContext.Provider>;
};
