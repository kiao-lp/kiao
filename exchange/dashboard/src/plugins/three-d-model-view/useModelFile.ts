import { useEffect, useState } from 'react';
import { readGlb } from './glb';
import { reportOn, type ModelReport } from './report';

/**
 * The file, fetched once and read twice.
 *
 * A model is a download of a few megabytes over an authenticated request, and there is no version
 * of this view worth having in which it happens twice — so the bytes are fetched here, the report
 * is read off them here, and the same `ArrayBuffer` is handed to the stage to draw from. That the
 * report comes from this side of the loader rather than from the other is the whole reason a file
 * that cannot be drawn still has something to say for itself.
 */
export interface ModelFile {
    /** What the file declares, as soon as its bytes are in — whether or not they can be drawn. */
    report: ModelReport | null;
    /** Those same bytes, for the stage. */
    data: ArrayBuffer | null;
    /** Bytes in and bytes expected while it is still arriving, `null` once it has arrived. */
    progress: Progress | null;
    /** Why there is no model at all: the store refused it, or it is not a glTF document. */
    error: string;
}

/** `total` is 0 when the server sends no length — a proxy that gzips, most often. */
export interface Progress { loaded: number; total: number }

const ARRIVING: ModelFile = { report: null, data: null, progress: { loaded: 0, total: 0 }, error: '' };

/**
 * How much has to have arrived before the message is worth redrawing: a whole percent where the
 * length is known, and a quarter of a megabyte where it is not. The stream reports every chunk,
 * which on a fast connection is far more often than anyone can read.
 */
const SILENT_BYTES = 256 * 1024;

export const useModelFile = (path: string, token?: string): ModelFile => {
    const [file, setFile] = useState<ModelFile>(ARRIVING);

    useEffect(() => {
        if (!path) return;
        setFile(ARRIVING);

        // The fetch outlives neither the document nor the token it was started under: a reader
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
            // The abort of a document being navigated away from is not a failure to report: the
            // state it would be reported into belongs to a file no longer open.
            if (controller.signal.aborted) return;
            setFile({ report: null, data: null, progress: null, error: messageOf(error) });
        });

        return () => controller.abort();
    }, [path, token]);

    return file;
};

/**
 * The bytes, read as they arrive.
 *
 * Through `fetch` rather than through the loader's own downloader, because the loader is the half
 * of this that may fail and the report must not fail with it. The token rides in a header rather
 * than in the query string: it is a credential, and a URL is the one part of a request that ends
 * up in logs and in the browser's history.
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
    // A response with no readable stream — an old browser, or a test's stub — is still a response;
    // it simply arrives all at once, with nothing to report on the way.
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
