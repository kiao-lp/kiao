import { describe, expect, it } from 'vitest';
import { NoAuthTokenProvider, StaticTokenProvider } from './auth.js';
import { loadConfig } from './config.js';
import { tokenProvider } from './server.js';

// These servers only ever run inside a worker turn, which hands them a token. There is no
// login flow left to fall back on, so the absence of a credential is a misconfiguration to report
// at startup rather than a state to run in.
describe('tokenProvider', () => {
    const configWith = (env: Record<string, string>) => {
        const saved = { ...process.env };
        Object.assign(process.env, env);
        try {
            return loadConfig();
        } finally {
            process.env = saved;
        }
    };

    it('uses a handed-over token when one is in the environment', () => {
        expect(tokenProvider(configWith({ KIAO_MCP_ACCESS_TOKEN: 'turn-abc' })))
            .toBeInstanceOf(StaticTokenProvider);
    });

    it('prefers the handed-over token over the no-auth switch', () => {
        // A turn on a `debug` worker. The token buys no access there, but it is what names
        // the user in the service's log, so it must still be sent.
        const provider = tokenProvider(
            configWith({ KIAO_MCP_ACCESS_TOKEN: 'turn-abc', KIAO_MCP_NO_AUTH: '1' }),
        );
        expect(provider).toBeInstanceOf(StaticTokenProvider);
    });

    it('falls back to no auth on a debug worker', () => {
        expect(tokenProvider(configWith({ KIAO_MCP_NO_AUTH: '1' })))
            .toBeInstanceOf(NoAuthTokenProvider);
    });

    it('refuses to start with neither, naming both variables', () => {
        expect(() => tokenProvider(configWith({}))).toThrow(/KIAO_MCP_ACCESS_TOKEN.*KIAO_MCP_NO_AUTH/s);
    });

    it('passes the token through verbatim — there is nothing to refresh', async () => {
        await expect(new StaticTokenProvider('turn-abc').getToken()).resolves.toBe('turn-abc');
    });
});
