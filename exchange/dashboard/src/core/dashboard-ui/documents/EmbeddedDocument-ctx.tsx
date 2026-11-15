import React, { createContext, useContext } from 'react';

const EmbeddedDocumentContext = createContext(false);

export const EmbeddedDocumentProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
    <EmbeddedDocumentContext.Provider value={true}>{children}</EmbeddedDocumentContext.Provider>
);

export const useEmbeddedDocument = (): boolean => useContext(EmbeddedDocumentContext);
