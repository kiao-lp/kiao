import React, { createContext, useContext } from 'react';

/**
 * LayoutContent's positioned, clipping document area contains dialog masks and wrappers,
 * keeping surrounding toolbars visible and usable.
 * Null before layout mount or outside it; consumers should fall back to the window.
 */
const DocumentAreaContext = createContext<HTMLElement | null>(null);

export const DocumentAreaProvider: React.FC<{
    element: HTMLElement | null;
    children?: React.ReactNode;
}> = ({ element, children }) => (
    <DocumentAreaContext.Provider value={element}>{children}</DocumentAreaContext.Provider>
);

export const useDocumentArea = (): HTMLElement | null => useContext(DocumentAreaContext);
