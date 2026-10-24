import React, { useState, useCallback } from "react";
import { FileDto } from "src/cms-core/files/service";
import { useWorkerClient } from "kiao-worker";
import { useFileBrowsingPersistenceContext } from "./FileBrowsingPersistence-ctx";

const Context = React.createContext<FileDto[]>([]);
const RefreshContext = React.createContext<() => void>(() => { });
const RevisionContext = React.createContext<number>(0);

const Provider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [fileList, setFileList] = useState<FileDto[]>([]);
    const [revision, setRevision] = useState(0);
    const { currentPath } = useFileBrowsingPersistenceContext();
    const client = useWorkerClient();

    const fetchFiles = useCallback(async () => {
        try {
            const files = await client.listFiles(currentPath);
            setFileList(prev => {
                if (JSON.stringify(prev) !== JSON.stringify(files)) {
                    return files;
                }
                return prev;
            });
        } catch (error) {
            console.error("Failed to list files", error);
        }
    }, [currentPath, client]);

    React.useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    /**
     * The store changed. Every file operation already calls this, so it is the one place the app
     * learns that a rename, a deletion or a creation has landed — and it says so twice: the
     * browsed folder is read again, and the revision below tells whatever else draws the store
     * from its own listings to read them again too.
     *
     * That second half is what a folder the browser is not on depends on: a row of the navigation
     * tree can be renamed, deleted, pasted into or created in from its own context menu, and
     * re-reading the browsed folder says nothing about the folder that changed.
     */
    const refresh = useCallback(() => {
        setRevision(previous => previous + 1);
        return fetchFiles();
    }, [fetchFiles]);

    return (
        <Context.Provider value={fileList}>
            <RevisionContext.Provider value={revision}>
                <RefreshContext.Provider value={refresh}>
                    {children}
                </RefreshContext.Provider>
            </RevisionContext.Provider>
        </Context.Provider>
    );
};

export const CurrentFileListProvider = Provider;
export const useCurrentFileListContext = () => React.useContext(Context);
export const useRefreshFileList = () => React.useContext(RefreshContext);

/**
 * How many times the store has been changed through the app, counted from the load. The number
 * itself means nothing: a new one means "read your listings again".
 */
export const useStoreRevision = () => React.useContext(RevisionContext);
