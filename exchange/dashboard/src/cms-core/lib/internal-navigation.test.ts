import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { markInternalNavigation, isRecentInternalNavigation, internalReload } from './internal-navigation';

describe('internal-navigation', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('reports no recent navigation by default and within the window after a mark', () => {
        // Advance past any window left over from earlier tests in the module.
        vi.advanceTimersByTime(1000);
        expect(isRecentInternalNavigation()).toBe(false);

        markInternalNavigation();
        expect(isRecentInternalNavigation()).toBe(true);

        vi.advanceTimersByTime(100);
        expect(isRecentInternalNavigation()).toBe(true);

        vi.advanceTimersByTime(250);
        expect(isRecentInternalNavigation()).toBe(false);
    });

    it('internalReload marks an internal navigation and reloads', () => {
        vi.advanceTimersByTime(1000);
        const reload = vi.fn();
        Object.defineProperty(window, 'location', {
            value: { ...window.location, reload },
            writable: true,
            configurable: true,
        });

        internalReload();

        expect(reload).toHaveBeenCalledOnce();
        expect(isRecentInternalNavigation()).toBe(true);
    });
});
