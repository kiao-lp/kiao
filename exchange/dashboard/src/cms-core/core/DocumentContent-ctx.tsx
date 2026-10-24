import React, { createContext, useContext } from 'react';

export const DOCUMENT_TAB_ID = 'document';

interface DocumentContentValue {
    content: React.ReactNode;
    additionalPanels?: React.ReactNode;
    /** Document panel element used to contain its dialogs. */
    areaRef: (element: HTMLDivElement | null) => void;
}

const DocumentContentContext = createContext<DocumentContentValue | null>(null);

export const useDocumentContentOptional = () => useContext(DocumentContentContext);

export const useDocumentContent = (): DocumentContentValue => {
    const context = useDocumentContentOptional();
    if (!context) throw new Error('DocumentPanel must be drawn by the layout that provides its content');
    return context;
};

/** The document and its controls share the layout's current provider scope. */
export const DocumentContentProvider: React.FC<{
    value: DocumentContentValue;
    children?: React.ReactNode;
}> = ({ value, children }) => (
    <DocumentContentContext.Provider value={value}>{children}</DocumentContentContext.Provider>
);
