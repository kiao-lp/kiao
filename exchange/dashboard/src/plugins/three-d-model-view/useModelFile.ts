import { useEffect, useState } from 'react';
import { readGlb } from './glb';
import { reportOn, type ModelReport } from './report';

/** The file, fetched once and read twice. */
export interface ModelFile {

    report: ModelReport | null;
    data: ArrayBuffer | null;

    progress: Progress | null;

    error: string;
}

/** `total` is 0 when the server sends no length — a proxy that gzips, most often. */
export interface Progress { loaded: number; total: number }

const ARRIVING: ModelFile = { report: null, data: null, progress: { loaded: 0, total: 0 }, error: '' };

/** How much has to have arrived before the message is worth redrawing: a whole percent. */
const SILENT_BYTES = 256 * 1024;

export const useModelFile = (path: string, token?: string): ModelFile => {
    const [file, setFile] = useState<ModelFile>(ARRIVING);

    useEffect(() => {
        if (!path) return;
        setFile(ARRIVING);

        // stepping through a folder of models would otherwise pull every one of them to the end.
        const controller = new AbortController();
        let shown = 0;

        download(path, token, controller.signal, (loaded, total) => {
            const enough = total > 0
                ? Math.floor((loaded / total) * 100) > Math.floor((shown / total) * 100)
                : loaded - shown >= SILENT_BYTES;
            if (!enough) return;
            shown = loaded;
            setFile({ ...ARRIVING, progress: { loaded, total } });
        }).then(data => {
            setFile({ report: reportOn(readGlb(data)), data, progress: null, error: '' });
        }).catch((error: unknown) => {
            if (controller.signal.aborted) return;
            setFile({ report: null, data: null, progress: null, error: messageOf(error) });
        });

        return () => controller.abort();
    }, [path, token]);

    return file;
};

/**
 * The bytes, read as they arrive.
 * Through `fetch` rather than through the loader's own downloader, because the loader is the half of.
 */
const download = async (
    path: string,
    token: string | undefined,
    signal: AbortSignal,
    onProgress: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> => {
    const url = `/api/files/getFile?path=${encodeURIComponent(path)}`;
    const response = await fetch(url, {
        signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
        throw new Error(`The store answered ${response.status} ${response.statusText || 'error'}.`);
    }

    const total = Number(response.headers.get('Content-Length') ?? 0);
    if (!response.body?.getReader) return response.arrayBuffer();

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        onProgress(loaded, total);
    }

    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes.buffer;
};

export const messageOf = (error: unknown): string => (
    error instanceof Error ? error.message : String(error)
);
