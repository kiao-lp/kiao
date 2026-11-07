import React, { createContext, useContext } from 'react';

/** Document area element for dialog containment; null outside layout. */
const DocumentAreaContext = createContext<HTMLElement | null>(null);

export const DocumentAreaProvider: React.FC<{
    element: HTMLElement | null;
    children?: React.ReactNode;
}> = ({ element, children }) => (
    <DocumentAreaContext.Provider value={element}>{children}</DocumentAreaContext.Provider>
);

export const useDocumentArea = (): HTMLElement | null => useContext(DocumentAreaContext);
