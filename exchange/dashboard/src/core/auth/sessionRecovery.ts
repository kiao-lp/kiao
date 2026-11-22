/** Silent recovery avoids page reloads that discard unsaved editor state. */
import type { User } from 'oidc-client-ts';

export interface RenewableSession {
    user?: User | null;
    /** react-oidc-context reports renewal failure as null rather than throwing. */
    signinSilent: (args?: { forceIframeAuth?: boolean }) => Promise<User | null>;
}

export type RecoveryOutcome =
    | 'refreshed'
    /** Re-authenticated in a hidden frame using the provider session. */
    | 'reauthenticated'
    /** A concurrent renewal left a usable stored token. */
    | 'still-valid'
    | 'login-required';

const attempt = async (
    session: RenewableSession,
    args?: { forceIframeAuth?: boolean },
): Promise<User | null> => {
    try {
        return await session.signinSilent(args);
    } catch (error: unknown) {
        console.warn('Session renewal attempt failed:', (error as Error)?.message ?? error);
        return null;
    }
};

/** Never navigates; the caller handles `login-required`. */
export const recoverSession = async (session: RenewableSession): Promise<RecoveryOutcome> => {
    if (await attempt(session)) return 'refreshed';
    if (await attempt(session, { forceIframeAuth: true })) return 'reauthenticated';

    const current = session.user;
    if (current && !current.expired) return 'still-valid';

    return 'login-required';
};

/**
 * Renew before dispatch: actions keep a snapshot token, so jobs outliving it are not protected.
 */
export const ACTION_TOKEN_MIN_LIFE_SECONDS = 240;

const renewSilently = async (session: RenewableSession): Promise<User | null> =>
    (await attempt(session)) ?? (await attempt(session, { forceIframeAuth: true }));

// Single-use refresh token: concurrent renewals share one grant to avoid `invalid_grant`.
let inFlight: Promise<User | null> | null = null;

/** Returns the renewed user, or null when no renewal is needed. Signin resolves before React state updates. */
export const ensureTokenLife = async (
    session: RenewableSession,
    minSecondsLeft: number,
): Promise<User | null> => {
    const left = session.user?.expires_in;
    if (left !== undefined && left >= minSecondsLeft) return null;

    return (inFlight ??= renewSilently(session).finally(() => { inFlight = null; }));
};
