import React, { createContext, useContext } from 'react';
import { useFileBrowsingPersistenceContext, useTextFileSync } from '@kiao-dashboard-core';

const MarkdownDocumentContext = createContext<ReturnType<typeof useTextFileSync> | null>(null);

/** Shared `useTextFileSync` for the editor and metadata controls. */
export const MarkdownDocumentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { currentFile } = useFileBrowsingPersistenceContext();
    const document = useTextFileSync(currentFile?.path);
    return <MarkdownDocumentContext.Provider value={document}>{children}</MarkdownDocumentContext.Provider>;
};

export function useMarkdownDocument() {
    const document = useContext(MarkdownDocumentContext);
    if (!document) throw new Error('MarkdownDocumentProvider is missing');
    return document;
}
