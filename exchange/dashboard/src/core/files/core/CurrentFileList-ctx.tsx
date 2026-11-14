import React, { useState, useCallback } from "react";
import { FileDto } from "src/core/files/service";
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

    // Re-reads the browsed folder and bumps revision so other listings re-read.
    // Needed when a non-browsed folder changes via its own context menu.
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

/** Store change counter from load. A new value signals re-reading listings. */
export const useStoreRevision = () => React.useContext(RevisionContext);
