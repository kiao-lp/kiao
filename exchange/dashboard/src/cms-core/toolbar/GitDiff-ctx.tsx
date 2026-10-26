import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export interface GitDiffTarget {
    /** Path of the file to diff, relative to the top level of the repository holding it. */
    path: string;
    /**
     * The store folder that names that repository. It travels with the path because the two are
     * only meaningful together: the same relative path names a different file in another
     * repository, and the diff must keep reading the one it was opened on even after the browser
     * has moved elsewhere.
     */
    folder: string;
    /**
     * Where the answering repository sits within the store: "" for the store's own, the
     * store-relative path for one nested inside it (`GitStatus.root`). It travels with the
     * path so the diff can open the working-tree file in the browser: `root` joined with
     * `path` is the store path, while `folder` alone is not — it may be a subfolder of the
     * repository rather than its top.
     */
    root: string;
}

interface GitDiffContextType {
    diffTarget: GitDiffTarget | null;
    openDiff: (path: string, folder: string, root?: string) => void;
    closeDiff: () => void;
    /** Bumped whenever the working tree changes; the Git panel refetches on change. */
    refreshToken: number;
    requestRefresh: () => void;
    /**
     * The working-tree pane's unsaved edits, or null when there are none for this base. Held here
     * rather than in the view because the panel belongs to the central area showing it: navigating
     * to another document or board brings up a new area with a new panel, which restores what was
     * typed instead of dropping it. A base that has moved under the draft — the file was reverted
     * or saved elsewhere — reads as no draft: what was typed was against other lines.
     */
    readDraft: (base: string) => string | null;
    /** Writes the draft, on every keystroke of the working-tree pane. */
    storeDraft: (base: string, text: string) => void;
    /** Drops the draft: the pane is clean again, saved, or closed. */
    clearDraft: () => void;
}

const GitDiffContext = createContext<GitDiffContextType | null>(null);

export const useGitDiff = (): GitDiffContextType => {
    const ctx = useContext(GitDiffContext);
    if (!ctx) {
        throw new Error('useGitDiff must be used within a GitDiffProvider');
    }
    return ctx;
};

export const useGitDiffOptional = (): GitDiffContextType | null => useContext(GitDiffContext);

export const GitDiffProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [diffTarget, setDiffTarget] = useState<GitDiffTarget | null>(null);
    const [refreshToken, setRefreshToken] = useState(0);
    // The draft lives in a ref: nothing renders from it — the pane reads it once after loading
    // and writes it on every keystroke — so it must never re-render anything. One slot is enough:
    // one diff is open at a time, and opening another drops what was typed in this one.
    const draft = useRef<{ base: string; text: string } | null>(null);
    // What `openDiff` compares against. The state setter's updater must stay pure — StrictMode
    // runs it twice — so the current target is read off a mirror rather than found inside one.
    const latest = useRef(diffTarget);
    latest.current = diffTarget;

    // Opening the file already open is opening it once: the pane keeps what it holds, edits and
    // all. Opening another drops the draft — it was typed against another file's lines.
    const openDiff = useCallback((path: string, folder: string, root: string = '') => {
        const prev = latest.current;
        if (prev && prev.path === path && prev.folder === folder && prev.root === root) return;
        draft.current = null;
        setDiffTarget({ path, folder, root });
    }, []);
    // Closing is abandoning: reopening the file reads it fresh, like a view that unmounted.
    const closeDiff = useCallback(() => {
        draft.current = null;
        setDiffTarget(null);
    }, []);
    const requestRefresh = useCallback(() => setRefreshToken(t => t + 1), []);

    const readDraft = useCallback((base: string): string | null => {
        const held = draft.current;
        if (!held) return null;
        if (held.base !== base) {
            draft.current = null;
            return null;
        }
        return held.text;
    }, []);
    const storeDraft = useCallback((base: string, text: string) => {
        draft.current = { base, text };
    }, []);
    const clearDraft = useCallback(() => {
        draft.current = null;
    }, []);

    const value = useMemo(() => ({
        diffTarget, openDiff, closeDiff, refreshToken, requestRefresh,
        readDraft, storeDraft, clearDraft,
    }), [diffTarget, openDiff, closeDiff, refreshToken, requestRefresh, readDraft, storeDraft, clearDraft]);

    return <GitDiffContext.Provider value={value}>{children}</GitDiffContext.Provider>;
};
