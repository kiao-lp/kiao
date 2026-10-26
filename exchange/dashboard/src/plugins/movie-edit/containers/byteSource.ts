/**
 * A file read a piece at a time.
 *
 * What reads a video's structure never wants the video: the few kilobytes that say where its
 * images are sit at one end of it, or in small pieces all through it, and between them are the
 * pictures — gigabytes of them.
 */
export interface ByteSource {
    /** The length of the whole file, in bytes. */
    readonly size: number;
    /** `length` bytes from `offset` — fewer only where the file ends first. */
    read(offset: number, length: number): Promise<Uint8Array>;
}

/** A file already in memory: the tests' fixtures. */
export const memorySource = (bytes: Uint8Array): ByteSource => ({
    size: bytes.length,
    read: async (offset, length) => bytes.subarray(offset, Math.min(bytes.length, offset + length)),
});

const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/;

const fetchRange = async (url: string, offset: number, length: number, signal?: AbortSignal) => {
    const response = await fetch(url, {
        headers: { Range: `bytes=${offset}-${offset + length - 1}` },
        signal,
    });
    // A server that ignores the range answers 200 with the whole file — for a video, the one
    // thing not to download to find out where its images are. It is dropped unread.
    if (response.status !== 206) {
        await response.body?.cancel();
        throw new Error(`The file was not served in pieces (HTTP ${response.status})`);
    }
    const range = CONTENT_RANGE.exec(response.headers.get('Content-Range') ?? '');
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { bytes, size: range ? Number(range[3]) : undefined };
};

/**
 * The file behind `url`, read by HTTP range requests — worker serves every file through
 * `http.ServeContent`, which honours them, and so do the proxies in front of it. The first
 * `headLength` bytes come back with it: that request is also what says how long the file is.
 */
export const openRangeSource = async (
    url: string,
    headLength: number,
    signal?: AbortSignal,
): Promise<{ source: ByteSource; head: Uint8Array }> => {
    const first = await fetchRange(url, 0, headLength, signal);
    const size = first.size ?? first.bytes.length;
    const source: ByteSource = {
        size,
        read: async (offset, length) => {
            const wanted = Math.min(length, size - offset);
            if (wanted <= 0) return new Uint8Array(0);
            return (await fetchRange(url, offset, wanted, signal)).bytes;
        },
    };
    return { source, head: first.bytes };
};
