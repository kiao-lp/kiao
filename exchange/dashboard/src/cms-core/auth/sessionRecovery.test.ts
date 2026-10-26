import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from 'oidc-client-ts';
import { ensureTokenLife, recoverSession, type RenewableSession } from './sessionRecovery';

/**
 * The bug this file exists for: a token renewal reloading the page.
 *
 * It has been fixed twice from the other end — pdf-view remembering its page number,
 * template-edit mirroring its heap into sessionStorage — so a third plugin (markdown)
 * losing its document meant the reload itself had never gone away. What follows pins
 * the reload down to the one case that genuinely needs it: the provider session is
 * gone and the user really does have to log in again.
 */

const userAt = (expired: boolean) => ({ expired, access_token: 'tok' } as unknown as User);

/** A live session with a known amount of life left in its token. */
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
        // The reproduced production failure: Keycloak answers the refresh grant with
        // invalid_grant (rotation, revocation, a refresh token past its window) while its
        // own session cookie is still perfectly good.
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
        // The property that matters, stated once over the whole ladder: the outcome that
        // costs the user their page is unreachable as long as either renewal works.
        for (const rung of ['grant', 'iframe'] as const) {
            const signinSilent = vi.fn(async (args?: { forceIframeAuth?: boolean }) =>
                (rung === 'grant') !== Boolean(args?.forceIframeAuth) ? userAt(false) : null,
            );

            await expect(recoverSession(session(signinSilent, userAt(true))))
                .resolves.not.toBe('login-required');
        }
    });
});

/**
 * The bug this half exists for: a publish refused with a 401 minutes after it started.
 *
 * A file action is fired on the token in hand and nothing renews it while the server works, so an
 * action started in the last minute of a 300-second token dies part-way through — which is what
 * happened to a 73-second unit publish. The token is topped up before the action goes out, and the
 * renewed one handed straight back rather than read off the session, which has not caught up yet.
 */
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

    // A renewal blip must not refuse an action that would have worked: the caller goes ahead on
    // the token it holds, exactly as it did before any of this existed.
    it('answers null, rather than throwing, when every silent route fails', async () => {
        const signinSilent = vi.fn(async () => null);

        await expect(ensureTokenLife(session(signinSilent, userLasting(30)), 240)).resolves.toBeNull();
    });

    it('answers null when the renewal throws', async () => {
        const signinSilent = vi.fn(async () => { throw new Error('Invalid refresh token'); });

        await expect(ensureTokenLife(session(signinSilent, userLasting(30)), 240)).resolves.toBeNull();
    });

    // A refresh token is single-use: two grants racing on the same one means the loser is answered
    // invalid_grant. Double-clicking Publish must not cost that.
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
