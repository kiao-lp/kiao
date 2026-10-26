import React, { createContext, useContext, useRef, useState } from 'react';
import { LoadedChildren } from './fileTreeModel';

/**
 * Plugin LayoutContent changes remount the tree. App-lifetime state preserves listings,
 * pending requests and scroll position, avoiding branch-by-branch reloads and layout jumps.
 */
export interface NavTreeStore {
    children: LoadedChildren;
    setChildren: React.Dispatch<React.SetStateAction<LoadedChildren>>;
    /** Pending folder listings survive remounts to prevent duplicate requests. */
    inFlight: React.MutableRefObject<Set<string>>;
    /** Pixels; recording scroll position must not trigger a render. */
    scrollTop: React.MutableRefObject<number>;
    /**
     * Last opened or toggled row, as a store-relative path (`''` for the root).
     * Branch toggles can diverge from the browsed folder; the Git panel follows this path.
     */
    focusedPath: string;
    setFocusedPath: React.Dispatch<React.SetStateAction<string>>;
}

const useOwnStore = (): NavTreeStore => {
    const [children, setChildren] = useState<LoadedChildren>({});
    const inFlight = useRef<Set<string>>(new Set());
    const scrollTop = useRef(0);
    const [focusedPath, setFocusedPath] = useState<string>('');
    return { children, setChildren, inFlight, scrollTop, focusedPath, setFocusedPath };
};

const NavTreeStoreContext = createContext<NavTreeStore | null>(null);

/** Must remain above plugin main views for the app lifetime. */
export const NavTreeStoreProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const store = useOwnStore();
    return <NavTreeStoreContext.Provider value={store}>{children}</NavTreeStoreContext.Provider>;
};

/** Without a provider, state belongs to the caller and is lost on unmount. */
export const useNavTreeStore = (): NavTreeStore => {
    const shared = useContext(NavTreeStoreContext);
    const own = useOwnStore();
    return shared ?? own;
};
