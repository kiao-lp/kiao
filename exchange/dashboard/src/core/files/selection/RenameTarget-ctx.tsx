import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export interface RenameTargetApi {
    renameTarget: string | null;
    startRename: (path: string) => void;
    cancelRename: () => void;
}

const RenameTargetContext = createContext<RenameTargetApi | null>(null);

export const RenameTargetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [renameTarget, setRenameTarget] = useState<string | null>(null);

    const startRename = useCallback((path: string) => setRenameTarget(path), []);
    const cancelRename = useCallback(() => setRenameTarget(null), []);

    const api = useMemo<RenameTargetApi>(() => ({ renameTarget, startRename, cancelRename }),
        [renameTarget, startRename, cancelRename]);

    return <RenameTargetContext.Provider value={api}>{children}</RenameTargetContext.Provider>;
};

export const useRenameTarget = (): RenameTargetApi => {
    const ctx = useContext(RenameTargetContext);
    if (!ctx) throw new Error('useRenameTarget must be used within a RenameTargetProvider');
    return ctx;
};
