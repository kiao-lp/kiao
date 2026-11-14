import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ToolsMenuItemDeclaration } from '../../extensibility/FileBasedPlugin';
import { useCentralStack } from '../documents/CentralStack-ctx';
import type { CentralPanel } from '../documents/CentralStack-ctx';
import { DOCUMENT_TAB_ID } from '../documents/DocumentContent-ctx';
import { useToolBarsOptional } from '../toolbars/ToolBars-ctx';

type OpenPanel = (panel: Omit<CentralPanel, 'host'>) => void;

interface ToolsMenuValue {
    items: ToolsMenuItemDeclaration[];
    openPanel: OpenPanel | null;
    registerTarget: (open: OpenPanel) => () => void;
}

const ToolsMenuContext = createContext<ToolsMenuValue | null>(null);

export const useToolsMenu = () => useContext(ToolsMenuContext);

export const ToolsMenuProvider: React.FC<{
    items: ToolsMenuItemDeclaration[];
    children: React.ReactNode;
}> = ({ items, children }) => {
    const [openPanel, setOpenPanel] = useState<OpenPanel | null>(null);
    const registerTarget = useCallback((open: OpenPanel) => {
        setOpenPanel(() => open);
        return () => setOpenPanel((current: OpenPanel | null) => current === open ? null : current);
    }, []);
    const value = useMemo(() => ({ items, openPanel, registerTarget }), [items, openPanel, registerTarget]);
    return <ToolsMenuContext.Provider value={value}>{children}</ToolsMenuContext.Provider>;
};

/** Connects the banner outside LayoutContent to its primary stack. */
export const ToolsMenuStackTarget: React.FC = () => {
    const registerTarget = useToolsMenu()?.registerTarget;
    const { push } = useCentralStack();
    const bars = useToolBarsOptional();
    const barsRef = useRef(bars);
    barsRef.current = bars;
    const open = useCallback<OpenPanel>(panel => {
        push({ ...panel, host: barsRef.current?.activeCentralTab() ?? DOCUMENT_TAB_ID });
    }, [push]);

    useEffect(() => registerTarget?.(open), [registerTarget, open]);
    return null;
};
