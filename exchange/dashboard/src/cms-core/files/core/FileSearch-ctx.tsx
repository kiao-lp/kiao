import React, { useState, useCallback } from 'react';
import { SearchResult } from 'src/cms-core/files/service';
import { useWorkerClient } from 'kiao-worker';
import { WorkerClient } from 'kiao-worker';
import { useFileBrowsingPersistenceContext } from './FileBrowsingPersistence-ctx';

export type FileSearchValue = {
    searchResults: SearchResult[] | null;
    isSearching: boolean;
    /** What the server said about the last refused query, ready to show on the search box. */
    searchError: string | null;
    /** The server capped the result set; the query needs narrowing. */
    searchTruncated: boolean;
    search: (query: string) => void;
    clearSearch: () => void;
};

const defaultValue: FileSearchValue = {
    searchResults: null,
    isSearching: false,
    searchError: null,
    searchTruncated: false,
    search: () => { },
    clearSearch: () => { },
};

const Context = React.createContext<FileSearchValue>(defaultValue);

export const FileSearchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchTruncated, setSearchTruncated] = useState(false);
    const workerClient = useWorkerClient();
    const { currentPath } = useFileBrowsingPersistenceContext();

    const search = useCallback(async (query: string) => {
        setIsSearching(true);
        setSearchError(null);
        try {
            const fs = workerClient as WorkerClient;
            if (fs.search) {
                const { results, truncated } = await fs.search(currentPath || "", query);
                setSearchResults(results);
                setSearchTruncated(truncated);
            } else {
                console.warn("Filesystem service does not support search");
            }
        } catch (e) {
            // The message is the server's plain-text complaint about the query. Leave the previous
            // results in place: a typo in the syntax should not wipe what the user was looking at.
            console.error(e);
            setSearchError(e instanceof Error ? e.message : String(e));
        } finally {
            setIsSearching(false);
        }
    }, [workerClient, currentPath]);

    const clearSearch = useCallback(() => {
        setSearchResults(null);
        setSearchError(null);
        setSearchTruncated(false);
    }, []);

    return (
        <Context.Provider value={{ searchResults, isSearching, searchError, searchTruncated, search, clearSearch }}>
            {children}
        </Context.Provider>
    );
};

export const useFileSearchContext = () => React.useContext(Context);
