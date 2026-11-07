import { useState, useEffect, useCallback } from 'react';
import { WorkerClient } from './client';
import { FileDto } from './types';

export function useCreateWorkerClient(baseUrl: string) {
    const [client] = useState(() => new WorkerClient(baseUrl));
    return client;
}

export function useFiles(client: WorkerClient, path: string) {
    const [files, setFiles] = useState<FileDto[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await client.listFiles(path);
            setFiles(data);
        } catch (err) {
            setError(err as Error);
        } finally {
            setLoading(false);
        }
    }, [client, path]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return { files, loading, error, refresh };
}

export function useFileContent<T = string>(client: WorkerClient, path: string, isJson: boolean = false) {
    const [content, setContent] = useState<T | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const fetchContent = useCallback(async () => {
        if (!path) return;
        setLoading(true);
        setError(null);
        try {
            const data = isJson
                ? await client.getFileJson<T>(path)
                : (await client.getFileText(path)) as unknown as T;
            setContent(data);
        } catch (err) {
            setError(err as Error);
        } finally {
            setLoading(false);
        }
    }, [client, path, isJson]);

    useEffect(() => {
        fetchContent();
    }, [fetchContent]);

    return { content, loading, error, refresh: fetchContent };
}
