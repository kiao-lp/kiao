/** Suppress GitSyncMonitor’s leave-warning for full-page navigation within Dashboard
 * or an OIDC round-trip. Router navigations do not unload the page. */

const DEFAULT_INTERNAL_NAV_WINDOW_MS = 200;
let internalNavUntil = 0;

/** Widen the window for navigation that starts after a network request, such as auth redirects. */
export const markInternalNavigation = (windowMs: number = DEFAULT_INTERNAL_NAV_WINDOW_MS): void => {
    internalNavUntil = Date.now() + windowMs;
};

export const isRecentInternalNavigation = (): boolean => Date.now() < internalNavUntil;

/** Reload without the git leave-warning. */
export const internalReload = (): void => {
    markInternalNavigation();
    window.location.reload();
};
