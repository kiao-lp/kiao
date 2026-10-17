import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AuthContext } from 'react-oidc-context';
import type { AuthContextProps } from 'react-oidc-context';

import { useAuthToken } from './authToken';
import { useAuthenticatedFileUrl } from '../files/service/authenticated-url';

// A session, as the OIDC provider would hand it down — only the token is read.
const session = (accessToken?: string) =>
    ({ user: accessToken ? { access_token: accessToken } : null }) as unknown as AuthContextProps;

const Token: React.FC = () => <span data-testid="v">{useAuthToken() ?? '∅'}</span>;
const FileUrl: React.FC = () => <span data-testid="v">{useAuthenticatedFileUrl('a b.md')}</span>;

const show = (cmp: React.ReactElement, auth?: AuthContextProps) => {
    render(auth ? <AuthContext.Provider value={auth}>{cmp}</AuthContext.Provider> : cmp);
    return screen.getByTestId('v').textContent;
};

afterEach(() => vi.restoreAllMocks());

describe('useAuthToken', () => {
    it('reads the token of the current session', () => {
        expect(show(<Token />, session('tok'))).toBe('tok');
    });

    it('has no token while the session is empty', () => {
        expect(show(<Token />, session())).toBe('∅');
    });

    // The regression this hook exists for: a no-security build mounts no AuthProvider, and
    // react-oidc-context's own useAuth() would warn to the console on every single render.
    it('has no token, and says nothing, when no provider is mounted', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(show(<Token />)).toBe('∅');
        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });

    it('has no token at all in a build made without security', async () => {
        vi.stubEnv('VITE_NO_SECURITY', 'true');
        vi.resetModules();
        const { useAuthToken: hook } = await import('./authToken');
        const NoSecurityToken: React.FC = () => <span data-testid="v">{hook() ?? '∅'}</span>;
        expect(show(<NoSecurityToken />, session('tok'))).toBe('∅');
        vi.unstubAllEnvs();
    });
});

describe('useAuthenticatedFileUrl', () => {
    it('carries the token as a query parameter, the path being escaped', () => {
        expect(show(<FileUrl />, session('tok'))).toBe('/api/files/getFile?path=a%20b.md&access_token=tok');
    });

    it('is the bare URL when there is no token to carry', () => {
        expect(show(<FileUrl />)).toBe('/api/files/getFile?path=a%20b.md');
    });
});
