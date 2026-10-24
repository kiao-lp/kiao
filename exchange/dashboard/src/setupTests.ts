import '@testing-library/jest-dom';
import { act } from '@testing-library/react';
import { afterAll, vi } from 'vitest';

// Mock only antd's runtime styles: keep the real controls, refs, portals and events.
// jsdom has no layout, and generating CSS on every mount makes parallel tests time out.
// Import the context here to apply the defaults even when a test supplies its own antd mock.
import 'antd/lib/theme/context';
vi.mock('antd/lib/theme/context', async importOriginal => {
    const actual = await importOriginal<typeof import('antd/lib/theme/context')>();
    // Mutate the shared defaults so antd's internal CommonJS imports see them too.
    Object.assign(actual.defaultConfig, { zeroRuntime: true });
    return actual;
});

// jsdom lacks ResizeObserver; antd auto-sizing controls need it to mount. Measurements are not tested.
if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
}
// jsdom lacks matchMedia; antd responsive controls need it. Layout tests must supply their own matches.
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
// Drain React commits and late antd timers before jsdom teardown, avoiding access to a destroyed window.
// Use act() and event-loop turns to accommodate slow machines; restore real timers for the waits.
afterAll(async () => {
    vi.useRealTimers();
    await act(async () => {
        for (let turn = 0; turn < 3; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
    });
});
