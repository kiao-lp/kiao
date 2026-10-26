import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { FileDto } from '../files/service';

export interface SecondaryDocumentValue {
    file: FileDto | null;
    open: (file: FileDto) => void;
    close: () => void;
}

const SecondaryDocumentContext = createContext<SecondaryDocumentValue | null>(null);

export const SecondaryDocumentProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const [file, setFile] = useState<FileDto | null>(null);

    const open = useCallback((next: FileDto) => {
        if (next.isDirectory) return;
        setFile(next);
    }, []);
    const close = useCallback(() => setFile(null), []);

    const value = useMemo(() => ({ file, open, close }), [file, open, close]);
    return <SecondaryDocumentContext.Provider value={value}>{children}</SecondaryDocumentContext.Provider>;
};

export const useSecondaryDocument = (): SecondaryDocumentValue => {
    const value = useContext(SecondaryDocumentContext);
    if (!value) throw new Error('useSecondaryDocument must be used within a SecondaryDocumentProvider');
    return value;
};

export const useSecondaryDocumentOptional = (): SecondaryDocumentValue | null =>
    useContext(SecondaryDocumentContext);
