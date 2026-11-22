import '@testing-library/jest-dom';
import { act } from '@testing-library/react';
import { afterAll, vi } from 'vitest';

// Mock only antd's runtime styles: keep the real controls, refs, portals and events.
import 'antd/lib/theme/context';
vi.mock('antd/lib/theme/context', async importOriginal => {
    const actual = await importOriginal<typeof import('antd/lib/theme/context')>();
    Object.assign(actual.defaultConfig, { zeroRuntime: true });
    return actual;
});

if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
}
if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
}
afterAll(async () => {
    vi.useRealTimers();
    await act(async () => {
        for (let turn = 0; turn < 3; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
    });
});
