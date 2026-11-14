import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from 'oidc-client-ts';
import { ensureTokenLife, recoverSession, type RenewableSession } from './sessionRecovery';

// Renewal must not reload the page; only a missing provider session requires login.

const userAt = (expired: boolean) => ({ expired, access_token: 'tok' } as unknown as User);

const userLasting = (expiresIn: number | undefined, token = 'tok') =>
    ({ expires_in: expiresIn, expired: false, access_token: token } as unknown as User);

const session = (
    signinSilent: RenewableSession['signinSilent'],
    user?: User | null,
): RenewableSession => ({ user, signinSilent });

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});

describe('recoverSession', () => {
    it('renews through the refresh-token grant, without touching the frame', async () => {
        const signinSilent = vi.fn(async () => userAt(false));

        const outcome = await recoverSession(session(signinSilent, userAt(true)));

        expect(outcome).toBe('refreshed');
        expect(signinSilent).toHaveBeenCalledTimes(1);
        expect(signinSilent).toHaveBeenCalledWith(undefined);
    });

    it('re-authenticates in the hidden frame when the refresh grant is refused', async () => {
        // Refresh grant returns invalid_grant while the provider session cookie stays valid.
        const signinSilent = vi.fn(async (args?: { forceIframeAuth?: boolean }) =>
            args?.forceIframeAuth ? userAt(false) : null,
        );

        const outcome = await recoverSession(session(signinSilent, userAt(true)));

        expect(outcome).toBe('reauthenticated');
        expect(signinSilent).toHaveBeenNthCalledWith(2, { forceIframeAuth: true });
    });

    it('re-authenticates in the hidden frame when the refresh grant throws', async () => {
        const signinSilent = vi.fn(async (args?: { forceIframeAuth?: boolean }) => {
            if (!args?.forceIframeAuth) throw new Error('Invalid refresh token');
            return userAt(false);
        });

        await expect(recoverSession(session(signinSilent, userAt(true)))).resolves.toBe('reauthenticated');
    });

    it('stands down when a concurrent renewal already stored a usable token', async () => {
        const signinSilent = vi.fn(async () => null);

        const outcome = await recoverSession(session(signinSilent, userAt(false)));

        expect(outcome).toBe('still-valid');
    });

    it('asks for an interactive login only once every silent route has failed', async () => {
        const signinSilent = vi.fn(async () => null);

        const outcome = await recoverSession(session(signinSilent, userAt(true)));

        expect(outcome).toBe('login-required');
        expect(signinSilent).toHaveBeenCalledTimes(2);
        expect(signinSilent).toHaveBeenNthCalledWith(1, undefined);
        expect(signinSilent).toHaveBeenNthCalledWith(2, { forceIframeAuth: true });
    });

    it('asks for an interactive login when there is no stored user at all', async () => {
        const signinSilent = vi.fn(async () => null);

        await expect(recoverSession(session(signinSilent, null))).resolves.toBe('login-required');
    });

    it('never reports login-required while any silent route can still succeed', async () => {
        for (const rung of ['grant', 'iframe'] as const) {
            const signinSilent = vi.fn(async (args?: { forceIframeAuth?: boolean }) =>
                (rung === 'grant') !== Boolean(args?.forceIframeAuth) ? userAt(false) : null,
            );

            await expect(recoverSession(session(signinSilent, userAt(true))))
                .resolves.not.toBe('login-required');
        }
    });
});

// Actions renew before dispatch so a long action does not outlive its token.
describe('ensureTokenLife', () => {
    it('leaves a token alone when it already outlives the work', async () => {
        const signinSilent = vi.fn(async () => userLasting(300, 'fresh'));

        const renewed = await ensureTokenLife(session(signinSilent, userLasting(280)), 240);

        expect(renewed).toBeNull();
        expect(signinSilent).not.toHaveBeenCalled();
    });

    it('renews a token with less life left than the work needs, and answers the new one', async () => {
        const fresh = userLasting(300, 'fresh');
        const signinSilent = vi.fn(async () => fresh);

        const renewed = await ensureTokenLife(session(signinSilent, userLasting(30)), 240);

        expect(renewed).toBe(fresh);
        expect(signinSilent).toHaveBeenCalledTimes(1);
        expect(signinSilent).toHaveBeenCalledWith(undefined);
    });

    it('renews when the session says nothing about how long it has', async () => {
        const signinSilent = vi.fn(async () => userLasting(300, 'fresh'));

        await ensureTokenLife(session(signinSilent, userLasting(undefined)), 240);

        expect(signinSilent).toHaveBeenCalledTimes(1);
    });

    it('falls to the hidden frame when the refresh grant is refused', async () => {
        const fresh = userLasting(300, 'fresh');
        const signinSilent = vi.fn(async (args?: { forceIframeAuth?: boolean }) =>
            args?.forceIframeAuth ? fresh : null,
        );

        await expect(ensureTokenLife(session(signinSilent, userLasting(30)), 240)).resolves.toBe(fresh);
        expect(signinSilent).toHaveBeenNthCalledWith(2, { forceIframeAuth: true });
    });

    // Failed renewal returns null; the caller proceeds with its current token.
    it('answers null, rather than throwing, when every silent route fails', async () => {
        const signinSilent = vi.fn(async () => null);

        await expect(ensureTokenLife(session(signinSilent, userLasting(30)), 240)).resolves.toBeNull();
    });

    it('answers null when the renewal throws', async () => {
        const signinSilent = vi.fn(async () => { throw new Error('Invalid refresh token'); });

        await expect(ensureTokenLife(session(signinSilent, userLasting(30)), 240)).resolves.toBeNull();
    });

    // Refresh tokens are single-use; concurrent renewals share one grant.
    it('shares one renewal between callers asking at the same time, and starts a new one after', async () => {
        const fresh = userLasting(300, 'fresh');
        let release: (user: User) => void = () => { };
        const gate = new Promise<User>(resolve => { release = resolve; });
        const signinSilent = vi.fn(async () => gate);
        const live = session(signinSilent, userLasting(30));

        const first = ensureTokenLife(live, 240);
        const second = ensureTokenLife(live, 240);
        release(fresh);

        expect(await first).toBe(fresh);
        expect(await second).toBe(fresh);
        expect(signinSilent).toHaveBeenCalledTimes(1);

        await ensureTokenLife(live, 240);
        expect(signinSilent).toHaveBeenCalledTimes(2);
    });
});
