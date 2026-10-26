import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { AgentAuthStatus } from 'kiao-worker';

const client = vi.hoisted(() => ({
    startAgentLogin: vi.fn(),
    submitAgentLoginCode: vi.fn(),
    cancelAgentLogin: vi.fn(),
}));

vi.mock('@cms-core', async () => ({
    useWorkerClient: () => client,
    Tooltip: (await import('antd')).Tooltip,
}));

// The real modal's portal and animations add nothing here; render its body and footer inline so
// the dialog's buttons are queryable the moment it opens. `message` is stubbed for the same
// reason — its global holder spins up a second React root, which costs seconds and shows nothing
// any assertion here looks at.
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

const signedOut: AgentAuthStatus = { loggedIn: false, loginEnabled: true };
const authorizeURL = 'https://claude.com/cai/oauth/authorize?code=true&state=xyz';

const renderPanel = (status: AgentAuthStatus | null, onSignedIn = vi.fn()) => {
    render(<ChatLoginPanel status={status} onSignedIn={onSignedIn} />);
    return onSignedIn;
};

/** Walks the dialog to the point where it waits for a code. */
const startSignIn = async () => {
    client.startAgentLogin.mockResolvedValue({ ok: true, url: authorizeURL });
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

    // Where the deployment does not expose signing in, the banner still explains the state but must
    // not offer a button that would only ever 404.
    it('offers the host command instead of a button when signing in is disabled', () => {
        renderPanel({ loggedIn: false, loginEnabled: false });

        expect(screen.getByText(/signed out on the server/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
        expect(screen.getByText('claude auth login')).toBeInTheDocument();
    });

    it('opens the authorisation link the service returned, then exchanges the pasted code', async () => {
        const onSignedIn = renderPanel(signedOut);
        client.submitAgentLoginCode.mockResolvedValue({ ok: true, message: 'Signed in.' });

        const input = await startSignIn();
        expect(screen.getByRole('link', { name: /authorisation page/i })).toHaveAttribute('href', authorizeURL);

        fireEvent.change(input, { target: { value: '  code#state  ' } });
        fireEvent.click(screen.getByRole('button', { name: /validate/i }));

        // Trimmed: a code copied from a web page routinely arrives with surrounding whitespace, and
        // the CLI would reject it verbatim.
        await waitFor(() => expect(client.submitAgentLoginCode).toHaveBeenCalledWith('code#state'));
        await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
        expect(screen.queryByTestId('login-modal')).not.toBeInTheDocument();
    });

    // A refused code leaves no session on the server, so the only way forward is a fresh start —
    // the dialog must say so rather than invite a second paste into a dead session.
    it('keeps the dialog open on a refused code and offers a fresh start', async () => {
        const onSignedIn = renderPanel(signedOut);
        client.submitAgentLoginCode.mockResolvedValue({ ok: false, message: 'Login failed: status 400' });

        const input = await startSignIn();
        fireEvent.change(input, { target: { value: 'wrong' } });
        fireEvent.click(screen.getByRole('button', { name: /validate/i }));

        expect(await screen.findByText('Login failed: status 400')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /start again/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /validate/i })).not.toBeInTheDocument();
        expect(onSignedIn).not.toHaveBeenCalled();
    });

    // Walking away from a started sign-in must kill the process parked on the server rather than
    // leave it sitting on its stdin until the session times out.
    it('abandons the sign-in on the server when the dialog is cancelled', async () => {
        renderPanel(signedOut);
        client.cancelAgentLogin.mockResolvedValue({ ok: true });

        await startSignIn();
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

        await waitFor(() => expect(client.cancelAgentLogin).toHaveBeenCalled());
        expect(screen.queryByTestId('login-modal')).not.toBeInTheDocument();
    });

    // A start that yields no URL is reported where the user is looking, not swallowed into a dialog
    // stuck on its spinner.
    it('reports a start that produced no link', async () => {
        renderPanel(signedOut);
        client.startAgentLogin.mockResolvedValue({ ok: false, message: 'the CLI printed no sign-in URL' });

        fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

        expect(await screen.findByText('the CLI printed no sign-in URL')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /start again/i })).toBeInTheDocument();
    });
});
