import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

/**
 * The three things every editor that takes a pasted image wants done the same way: the paste is
 * caught before the box makes plain text of it, the file is written where the dialog said, and what
 * goes back into the document is a link written against the document that holds it.
 */

const client = vi.hoisted(() => ({ update: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@cms-core', () => ({
    useWorkerClient: () => client,
    extractName: (path: string) => path.slice(path.lastIndexOf('/') + 1),
}));

import { useImagePaste } from './useImagePaste';

/** A clipboard carrying one file of the given type, as the browser hands it over. */
const clipboard = (type: string): DataTransfer => ({
    items: [{ kind: 'file', type, getAsFile: () => new File(['x'], 'shot.png', { type }) }],
} as unknown as DataTransfer);

/** A paste event, with the two calls the handler is expected to make on it. */
const pasteOf = (data: DataTransfer | null) => ({
    clipboardData: data,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
}) as unknown as React.ClipboardEvent & { preventDefault: ReturnType<typeof vi.fn> };

const blob = new Blob(['x'], { type: 'image/png' });

beforeEach(() => vi.clearAllMocks());

describe('useImagePaste', () => {
    it('opens the dialog on a pasted image, and takes the event with it', () => {
        const { result } = renderHook(() => useImagePaste('/backlog', 'board.md', vi.fn()));
        const event = pasteOf(clipboard('image/png'));

        act(() => result.current.onPasteCapture(event));

        expect(result.current.modalProps.image).not.toBeNull();
        expect(event.preventDefault).toHaveBeenCalled();
    });

    // Pasting text into a box that also takes images is still pasting text.
    it('leaves a paste that carries no image alone', () => {
        const { result } = renderHook(() => useImagePaste('/backlog', 'board.md', vi.fn()));
        const event = pasteOf(clipboard('text/plain'));

        act(() => result.current.onPasteCapture(event));

        expect(result.current.modalProps.image).toBeNull();
        expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('writes the file and links it relative to the document holding it', async () => {
        const insert = vi.fn();
        const { result } = renderHook(() => useImagePaste('/backlog', 'board.md', insert));

        await act(() => result.current.modalProps.onConfirm(
            { storage: 'file', path: '/backlog/shot.png', blob, dataUrl: 'data:x' }));

        expect(client.update).toHaveBeenCalledWith('/backlog/shot.png', blob);
        expect(insert).toHaveBeenCalledWith('![shot.png](shot.png)');
        expect(result.current.modalProps.image).toBeNull();
    });

    // A card's body is held in a database row, not a document, so the link is written from the
    // store root even though the file sits in the board's folder — while the dialog still offers
    // that folder as where the image belongs.
    it('links from the store root for content held nowhere', async () => {
        const insert = vi.fn();
        const { result } = renderHook(() => useImagePaste('boards/major', 'major', insert, true));

        expect(result.current.modalProps.defaultDirectory).toBe('boards/major');
        await act(() => result.current.modalProps.onConfirm(
            { storage: 'file', path: '/boards/major/shot.png', blob, dataUrl: 'data:x' }));

        expect(client.update).toHaveBeenCalledWith('/boards/major/shot.png', blob);
        expect(insert).toHaveBeenCalledWith('![shot.png](/boards/major/shot.png)');
    });

    // Anywhere else has no short form, so it is written from the store root — the leading slash is
    // the only thing telling the two readings apart.
    it('links an image saved outside that folder from the store root', async () => {
        const insert = vi.fn();
        const { result } = renderHook(() => useImagePaste('/backlog', 'board.md', insert));

        await act(() => result.current.modalProps.onConfirm(
            { storage: 'file', path: '/design/a mockup.png', blob, dataUrl: 'data:x' }));

        expect(insert).toHaveBeenCalledWith('![a mockup.png](/design/a%20mockup.png)');
    });

    it('embeds the image itself when that is what was asked for', async () => {
        const insert = vi.fn();
        const { result } = renderHook(() => useImagePaste('/backlog', 'board.md', insert));

        await act(() => result.current.modalProps.onConfirm(
            { storage: 'embed', blob, dataUrl: 'data:image/png;base64,AAAA' }));

        expect(client.update).not.toHaveBeenCalled();
        expect(insert).toHaveBeenCalledWith('![image](data:image/png;base64,AAAA)');
    });

    // A document at the store root has `/` for a folder, which would otherwise name the image
    // `//shot.png` — a path nothing in the store answers to.
    it('reads the store root as no folder at all', async () => {
        const insert = vi.fn();
        const { result } = renderHook(() => useImagePaste('/', 'board.md', insert));

        expect(result.current.modalProps.defaultDirectory).toBe('');
        await act(() => result.current.modalProps.onConfirm(
            { storage: 'file', path: '/shot.png', blob, dataUrl: 'data:x' }));
        expect(insert).toHaveBeenCalledWith('![shot.png](shot.png)');
    });
});
