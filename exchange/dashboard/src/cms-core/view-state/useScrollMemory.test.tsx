import React, { useRef } from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useScrollMemory } from './useScrollMemory';
import { useViewStateStore } from './ViewState-ctx';
import { useFileBrowsingPersistenceContext } from 'src/cms-core/files/core/FileBrowsingPersistence-ctx';

vi.mock('src/cms-core/files/core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: vi.fn(),
}));
vi.mock('./ViewState-ctx', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./ViewState-ctx')>()),
    useViewStateStore: vi.fn(),
}));

const PATH = 'units/abc/cadre.md';

/** A store standing in for the provider, so writes can be inspected directly. */
const fakeStore = (scroll: Record<string, number> = {}) => {
    const scopes: Record<string, any> = { scroll: { ...scroll } };
    return {
        scopes,
        getFileScope: vi.fn((_p: string, key: string, defaults: any) => ({ ...defaults, ...scopes[key] })),
        setFileScope: vi.fn((_p: string, key: string, value: any) => { scopes[key] = value; }),
        getFolderScope: vi.fn((_p, _k, d) => d),
        setFolderScope: vi.fn(),
        getGlobal: vi.fn((_k, f) => f),
        setGlobal: vi.fn(),
        flush: vi.fn(),
    };
};

/** A scroll container whose content height is under the test's control. */
const Scroller: React.FC<{ scrollHeight: number; enabled?: boolean }> = ({ scrollHeight, enabled = true }) => {
    const ref = useRef<HTMLDivElement>(null);
    useScrollMemory(ref, 'main', enabled);
    return <div ref={ref} data-testid="scroller" style={{ height: 100, overflow: 'auto' }}>
        <div style={{ height: scrollHeight }} />
    </div>;
};

const sizeElement = (el: HTMLElement, clientHeight: number, scrollHeight: number) => {
    Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
};

/** jsdom does not lay out, so scrollTop is a plain, unclamped property here. */
const renderScroller = (store: ReturnType<typeof fakeStore>, opts: { clientHeight: number; scrollHeight: number; enabled?: boolean }) => {
    vi.mocked(useViewStateStore).mockReturnValue(store as any);
    const utils = render(<Scroller scrollHeight={opts.scrollHeight} enabled={opts.enabled} />);
    const el = utils.getByTestId('scroller');
    sizeElement(el, opts.clientHeight, opts.scrollHeight);
    return { ...utils, el };
};

const flushFrames = async (n = 3) => {
    for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 20)); });
};

describe('useScrollMemory', () => {
    beforeEach(() => {
        vi.mocked(useFileBrowsingPersistenceContext).mockReturnValue({
            currentFile: { path: PATH, isDirectory: false, size: 0, lastModified: 0 },
            currentPath: '',
        } as any);
    });
    afterEach(() => vi.restoreAllMocks());

    it('restores the stored offset once the content is tall enough', async () => {
        const store = fakeStore({ main: 400 });
        const { el } = renderScroller(store, { clientHeight: 100, scrollHeight: 1000 });

        await flushFrames();

        expect(el.scrollTop).toBe(400);
    });

    // Content arrives after mount; the first frame usually has nothing to scroll.
    it('keeps trying while the content is still too short', async () => {
        const store = fakeStore({ main: 400 });
        const { el } = renderScroller(store, { clientHeight: 100, scrollHeight: 100 });

        await flushFrames();
        expect(el.scrollTop).toBe(0);

        sizeElement(el, 100, 1000);
        await flushFrames();

        expect(el.scrollTop).toBe(400);
    });

    it('does nothing when the file has no stored offset', async () => {
        const store = fakeStore();
        const { el } = renderScroller(store, { clientHeight: 100, scrollHeight: 1000 });

        await flushFrames();

        expect(el.scrollTop).toBe(0);
    });

    // Fighting the user for the scroll position would be worse than forgetting it.
    it('abandons the restore as soon as the user scrolls', async () => {
        const store = fakeStore({ main: 400 });
        const { el } = renderScroller(store, { clientHeight: 100, scrollHeight: 100 });

        await act(async () => {
            el.scrollTop = 50;
            el.dispatchEvent(new Event('scroll'));
        });
        sizeElement(el, 100, 1000);
        await flushFrames();

        expect(el.scrollTop).toBe(50);
    });

    it('records where the container was left', async () => {
        const store = fakeStore();
        const { el, unmount } = renderScroller(store, { clientHeight: 100, scrollHeight: 1000 });
        await flushFrames();

        await act(async () => {
            el.scrollTop = 275;
            el.dispatchEvent(new Event('scroll'));
        });
        unmount();

        expect(store.setFileScope).toHaveBeenCalledWith(PATH, 'scroll', expect.objectContaining({ main: 275 }));
    });

    // A file whose content never loaded would otherwise be recorded at the top.
    it('does not record an offset when the content never arrived', async () => {
        const store = fakeStore({ main: 400 });
        const { unmount } = renderScroller(store, { clientHeight: 0, scrollHeight: 0 });

        await flushFrames();
        unmount();

        expect(store.setFileScope).not.toHaveBeenCalled();
    });

    // Opening a file and leaving without touching it must not write a 0 into a
    // git-tracked file — that would be an entry for every file ever opened.
    it('writes nothing when the container was never scrolled', async () => {
        const store = fakeStore();
        const { unmount } = renderScroller(store, { clientHeight: 100, scrollHeight: 1000 });

        await flushFrames();
        unmount();

        expect(store.setFileScope).not.toHaveBeenCalled();
    });

    // A successful restore already matches what is stored; re-writing it is noise.
    it('writes nothing when it only restored', async () => {
        const store = fakeStore({ main: 400 });
        const { unmount } = renderScroller(store, { clientHeight: 100, scrollHeight: 1000 });

        await flushFrames();
        unmount();

        expect(store.setFileScope).not.toHaveBeenCalled();
    });

    it('stays out of the way while its pane is hidden', async () => {
        const store = fakeStore({ main: 400 });
        const { el } = renderScroller(store, { clientHeight: 100, scrollHeight: 1000, enabled: false });

        await flushFrames();

        expect(el.scrollTop).toBe(0);
        expect(store.setFileScope).not.toHaveBeenCalled();
    });

    // Several containers share the file's one scroll scope.
    it('leaves the offsets of the other containers alone', async () => {
        const store = fakeStore({ preview: 900 });
        const { el, unmount } = renderScroller(store, { clientHeight: 100, scrollHeight: 1000 });
        await flushFrames();

        await act(async () => {
            el.scrollTop = 120;
            el.dispatchEvent(new Event('scroll'));
        });
        unmount();

        expect(store.scopes.scroll).toEqual({ preview: 900, main: 120 });
    });
});
