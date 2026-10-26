import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Whether the file-optimizations view is up.
 *
 * It is an **application mode**, like the Git diff and unlike a tool bar tab: it takes the central
 * area over instead of sitting in a column. That is the shape of what it draws — a table of file
 * tuples with two columns of radios in each, and a table of the biggest files — and none of it
 * survives being folded into 300 pixels of column. It is also what it is *about*: the store as a
 * whole rather than the open document, so there is nothing for it to sit beside.
 *
 * One flag, held above the layout, for the same reason the diff target is: the menu that opens it
 * is in the top banner and the view that answers is in the middle of the app, and the two have no
 * closer ancestor.
 */
interface FileOptimizationsContextType {
    open: boolean;
    show: () => void;
    hide: () => void;
    toggle: () => void;
}

const FileOptimizationsContext = createContext<FileOptimizationsContextType | null>(null);

export const useFileOptimizationsView = (): FileOptimizationsContextType => {
    const ctx = useContext(FileOptimizationsContext);
    if (!ctx) throw new Error('useFileOptimizationsView must be used within a FileOptimizationsProvider');
    return ctx;
};

/** The same, for the banner: the menu is drawn in trees this provider is not in — the tests'. */
export const useFileOptimizationsViewOptional = (): FileOptimizationsContextType | null =>
    useContext(FileOptimizationsContext);

export const FileOptimizationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [open, setOpen] = useState(false);
    const show = useCallback(() => setOpen(true), []);
    const hide = useCallback(() => setOpen(false), []);
    const toggle = useCallback(() => setOpen(o => !o), []);
    const value = useMemo(() => ({ open, show, hide, toggle }), [open, show, hide, toggle]);
    return <FileOptimizationsContext.Provider value={value}>{children}</FileOptimizationsContext.Provider>;
};
