import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { HarnessAuthStatus } from 'kiao-worker';

const client = vi.hoisted(() => ({
    startHarnessLogin: vi.fn(),
    submitHarnessLoginCode: vi.fn(),
    cancelHarnessLogin: vi.fn(),
}));

vi.mock('@kiao-dashboard-core', async () => ({
    useWorkerClient: () => client,
    Tooltip: (await import('antd')).Tooltip,
}));

vi.mock('antd', async (importOriginal) => {
    const actual = await importOriginal<typeof import('antd')>();
    return {
        ...actual,
        Modal: ({ open, children, footer }: any) =>
            open ? <div data-testid="login-modal">{children}<div>{footer}</div></div> : null,
        message: { success: vi.fn(), error: vi.fn() },
    };
});

import { ChatLoginPanel } from './ChatLoginPanel';

const signedOut: HarnessAuthStatus = { loggedIn: false, loginEnabled: true };
const authorizeURL = 'https://claude.com/cai/oauth/authorize?code=true&state=xyz';

const renderPanel = (status: HarnessAuthStatus | null, onSignedIn = vi.fn()) => {
    render(<ChatLoginPanel status={status} onSignedIn={onSignedIn} />);
    return onSignedIn;
};

/** Walks the dialog to the point where it waits for a code. */
const startSignIn = async () => {
    client.startHarnessLogin.mockResolvedValue({ ok: true, url: authorizeURL });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    return screen.findByPlaceholderText('Paste the code here');
};

describe('ChatLoginPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // The banner is a call to action: with nothing to act on it must not appear at all.
    it('renders nothing while the host is signed in, or its status unknown', () => {
        const { container } = render(
            <ChatLoginPanel status={{ loggedIn: true, loginEnabled: true }} onSignedIn={vi.fn()} />,
        );
        expect(container).toBeEmptyDOMElement();

        const unknown = render(<ChatLoginPanel status={null} onSignedIn={vi.fn()} />);
        expect(unknown.container).toBeEmptyDOMElement();
    });

    // Where the deployment does not expose signing in, the banner still explains the state but must not offer a button that would only.
    it('offers the host command instead of a button when signing in is disabled', () => {
        renderPanel({ loggedIn: false, loginEnabled: false });

        expect(screen.getByText(/signed out on the server/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
        expect(screen.getByText('claude auth login')).toBeInTheDocument();
    });

    it('opens the authorisation link the service returned, then exchanges the pasted code', async () => {
        const onSignedIn = renderPanel(signedOut);
        client.submitHarnessLoginCode.mockResolvedValue({ ok: true, message: 'Signed in.' });

        const input = await startSignIn();
        expect(screen.getByRole('link', { name: /authorisation page/i })).toHaveAttribute('href', authorizeURL);

        fireEvent.change(input, { target: { value: '  code#state  ' } });
        fireEvent.click(screen.getByRole('button', { name: /validate/i }));

        await waitFor(() => expect(client.submitHarnessLoginCode).toHaveBeenCalledWith('code#state'));
        await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
        expect(screen.queryByTestId('login-modal')).not.toBeInTheDocument();
    });

    // A refused code leaves no session on the server, so the only way forward is a fresh start — the dialog must say so rather than.
    it('keeps the dialog open on a refused code and offers a fresh start', async () => {
        const onSignedIn = renderPanel(signedOut);
        client.submitHarnessLoginCode.mockResolvedValue({ ok: false, message: 'Login failed: status 400' });

        const input = await startSignIn();
        fireEvent.change(input, { target: { value: 'wrong' } });
        fireEvent.click(screen.getByRole('button', { name: /validate/i }));

        expect(await screen.findByText('Login failed: status 400')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /start again/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /validate/i })).not.toBeInTheDocument();
        expect(onSignedIn).not.toHaveBeenCalled();
    });

    // Walking away from a started sign-in must kill the process parked on the server rather than
    it('abandons the sign-in on the server when the dialog is cancelled', async () => {
        renderPanel(signedOut);
        client.cancelHarnessLogin.mockResolvedValue({ ok: true });

        await startSignIn();
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

        await waitFor(() => expect(client.cancelHarnessLogin).toHaveBeenCalled());
        expect(screen.queryByTestId('login-modal')).not.toBeInTheDocument();
    });

    it('reports a start that produced no link', async () => {
        renderPanel(signedOut);
        client.startHarnessLogin.mockResolvedValue({ ok: false, message: 'the CLI printed no sign-in URL' });

        fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

        expect(await screen.findByText('the CLI printed no sign-in URL')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /start again/i })).toBeInTheDocument();
    });
});
