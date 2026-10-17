import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useModelFile } from './useModelFile';

/** The smallest whole binary glTF: a header, and a document declaring nothing but its version. */
const glb = (document: object = { asset: { version: '2.0' } }): ArrayBuffer => {
    const text = new TextEncoder().encode(JSON.stringify(document));
    const json = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20);
    json.set(text);

    const buffer = new ArrayBuffer(20 + json.length);
    const view = new DataView(buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, buffer.byteLength, true);
    view.setUint32(12, json.length, true);
    view.setUint32(16, 0x4e4f534a, true);
    new Uint8Array(buffer).set(json, 20);
    return buffer;
};

/** A response with no readable body, which is the shape a browser gives for a cached one too. */
const respondWith = (data: ArrayBuffer, ok = true, status = 200) => vi.fn(async () => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Not Found',
    headers: new Headers({ 'Content-Length': String(data.byteLength) }),
    body: null,
    arrayBuffer: async () => data,
}));

const stub = (fetchMock: ReturnType<typeof respondWith>) => vi.stubGlobal('fetch', fetchMock);

afterEach(() => vi.unstubAllGlobals());

describe('useModelFile', () => {
    it('fetches the file once, and reads the report off the bytes it hands the stage', async () => {
        const data = glb({ asset: { version: '2.0', generator: 'Test exporter' } });
        const fetchMock = respondWith(data);
        stub(fetchMock);

        const { result } = renderHook(() => useModelFile('/models/chair.glb'));
        await waitFor(() => expect(result.current.report).not.toBeNull());

        expect(fetchMock).toHaveBeenCalledTimes(1);
        // The same buffer, not a second copy of it: one download serves the report and the stage.
        expect(result.current.data).toBe(data);
        expect(result.current.report?.identity.generator).toBe('Test exporter');
        expect(result.current.progress).toBeNull();
        expect(result.current.error).toBe('');
    });

    it('asks for the file by path, and carries the token in a header', async () => {
        const fetchMock = respondWith(glb());
        stub(fetchMock);

        renderHook(() => useModelFile('/models/a chair.glb', 'secret-token'));
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());

        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('/api/files/getFile?path=%2Fmodels%2Fa%20chair.glb');
        expect(init.headers).toEqual({ Authorization: 'Bearer secret-token' });
        // A URL ends up in logs and in history; a credential does not belong in one.
        expect(url).not.toContain('secret-token');
    });

    it('reports the store refusing the file, rather than a model', async () => {
        stub(respondWith(new ArrayBuffer(0), false, 404));

        const { result } = renderHook(() => useModelFile('/models/gone.glb'));
        await waitFor(() => expect(result.current.error).not.toBe(''));

        expect(result.current.error).toMatch(/404/);
        expect(result.current.data).toBeNull();
        expect(result.current.report).toBeNull();
    });

    it('reports bytes that are not a glTF document at all', async () => {
        stub(respondWith(new TextEncoder().encode('this is not a model').buffer as ArrayBuffer));

        const { result } = renderHook(() => useModelFile('/models/notes.glb'));
        await waitFor(() => expect(result.current.error).not.toBe(''));

        expect(result.current.error).toMatch(/not a glTF document/);
    });

    it('gives up the download when the reader moves on', async () => {
        const fetchMock = respondWith(glb());
        stub(fetchMock);

        const { unmount } = renderHook(() => useModelFile('/models/chair.glb'));
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const { signal } = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];

        expect(signal?.aborted).toBe(false);
        unmount();
        // Stepping through a folder of models would otherwise pull every one of them to the end.
        expect(signal?.aborted).toBe(true);
    });
});
