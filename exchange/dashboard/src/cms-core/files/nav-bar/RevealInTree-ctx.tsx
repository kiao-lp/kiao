import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export interface RevealInTree {
    /** Pending store path: '' is the root; null means no request. */
    request: string | null;
    /** Open ancestors and scroll the path's row into view. */
    reveal: (path: string) => void;
    /** Consume the request once the tree accepts it. */
    taken: () => void;
}

/**
 * Requests wait for a tree to mount, even if the requesting click opens its pane.
 * Consume once: replaying after a pane remount would override the current document.
 */
const RevealInTreeContext = createContext<RevealInTree | null>(null);

const useOwnRequest = (): RevealInTree => {
    const [request, setRequest] = useState<string | null>(null);
    const reveal = useCallback((path: string) => setRequest(path), []);
    const taken = useCallback(() => setRequest(null), []);
    return useMemo(() => ({ request, reveal, taken }), [request, reveal, taken]);
};

/** Keep above panes so pending requests survive their remounts. */
export const RevealInTreeProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
    <RevealInTreeContext.Provider value={useOwnRequest()}>{children}</RevealInTreeContext.Provider>
);

/** Without a provider, reveal is a no-op for standalone components. */
export const useRevealInTree = (): RevealInTree => {
    const shared = useContext(RevealInTreeContext);
    const own = useOwnRequest();
    return shared ?? own;
};
