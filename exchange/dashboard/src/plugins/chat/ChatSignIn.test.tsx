import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AgentLoginOffer } from 'kiao-worker';
import { WorkerError } from 'kiao-worker';

const client = vi.hoisted(() => ({
    startAgentDeviceLogin: vi.fn(),
    getAgentDeviceLoginStatus: vi.fn(),
    cancelAgentDeviceLogin: vi.fn(),
    submitAgentApiKey: vi.fn(),
}));

const feedback = vi.hoisted(() => ({
    success: vi.fn(),
    error: vi.fn(),
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
        message: feedback,
    };
});

import { ChatSignIn, DEVICE_POLL_MS } from './ChatSignIn';

const both: AgentLoginOffer = { methods: ['device', 'api-key'], enabled: true, hostCommand: 'muse login' };
const deviceOnly: AgentLoginOffer = { methods: ['device'], enabled: true, hostCommand: 'muse login' };
const keyOnly: AgentLoginOffer = { methods: ['api-key'], enabled: true, hostCommand: 'muse auth set --api-key-stdin' };
const disabled: AgentLoginOffer = { methods: ['device', 'api-key'], enabled: false, hostCommand: 'muse login' };

const PAGE = 'https://auth.meta.com/oauth/device/?code=RDSN-TCSF';

const renderSignIn = (login: AgentLoginOffer = both) =>
    render(<ChatSignIn agent="muse" label="Muse" login={login} />);

/** Opens the dialog and flushes the device start, leaving the wait on screen. */
const openOnTheWait = async () => {
    client.startAgentDeviceLogin.mockResolvedValue({ ok: true, url: PAGE, userCode: 'RDSN-TCSF' });
    fireEvent.click(screen.getByRole('button', { name: 'Log in to Muse' }));
    await vi.advanceTimersByTimeAsync(0);
};

describe('ChatSignIn', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // Where the deployment does not expose signing in, the host command is named instead of a
    // button that would only ever 404.
    it('offers the host command instead of a button when signing in is disabled', () => {
        renderSignIn(disabled);

        expect(screen.queryByRole('button', { name: /log in/i })).not.toBeInTheDocument();
        expect(screen.getByText('muse login')).toBeInTheDocument();
    });

    // The device flow: the dialog opens on the page and the code, polls the wait, and closes with
    // the CLI's own sentence once the approval lands. A finished wait needs no cancelling, since
    // reading it consumed it.
    it('waits the device flow out and closes on approval', async () => {
        vi.useFakeTimers();
        client.cancelAgentDeviceLogin.mockResolvedValue({ ok: true });
        renderSignIn();
        await openOnTheWait();

        expect(client.startAgentDeviceLogin).toHaveBeenCalledWith('muse');
        expect(screen.getByRole('link', { name: /open the sign-in page/i })).toHaveAttribute('href', PAGE);
        expect(screen.getByText('RDSN-TCSF')).toBeInTheDocument();
        expect(screen.getByText('Waiting for approval…')).toBeInTheDocument();

        client.getAgentDeviceLoginStatus.mockResolvedValueOnce({ pending: true, ok: false });
        await vi.advanceTimersByTimeAsync(DEVICE_POLL_MS);
        expect(screen.getByText('Waiting for approval…')).toBeInTheDocument();

        client.getAgentDeviceLoginStatus.mockResolvedValueOnce({ pending: false, ok: true, message: 'Logged in.' });
        await vi.advanceTimersByTimeAsync(DEVICE_POLL_MS);
        expect(feedback.success).toHaveBeenCalledWith('Logged in.');
        expect(screen.queryByTestId('login-modal')).not.toBeInTheDocument();
        expect(client.cancelAgentDeviceLogin).not.toHaveBeenCalled();
    });

    // A refused approval fails the dialog rather than closing it: the way out is another start,
    // not the dead code.
    it('says a refused approval and offers another start', async () => {
        vi.useFakeTimers();
        renderSignIn();
        await openOnTheWait();

        client.getAgentDeviceLoginStatus.mockResolvedValueOnce({ pending: false, ok: false, message: 'approval denied' });
        await vi.advanceTimersByTimeAsync(DEVICE_POLL_MS);

        expect(screen.getByText('approval denied')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
        await vi.advanceTimersByTimeAsync(0);
        expect(client.startAgentDeviceLogin).toHaveBeenCalledTimes(2);
    });

    // Closing the dialog abandons a wait still in flight, which kills the process parked on the
    // server — best effort, since a failed cancel changes nothing the user can act on.
    it('cancels the wait when the dialog is closed on it', async () => {
        vi.useFakeTimers();
        client.cancelAgentDeviceLogin.mockResolvedValue({ ok: true });
        renderSignIn();
        await openOnTheWait();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(client.cancelAgentDeviceLogin).toHaveBeenCalledWith('muse');
        expect(screen.queryByTestId('login-modal')).not.toBeInTheDocument();
    });

    // 409 is a wait that ended elsewhere — cancelled, expired, or already read. The dialog fails
    // with a way back rather than polling a flow that is gone.
    it('says a wait that ended elsewhere and offers another start', async () => {
        vi.useFakeTimers();
        renderSignIn();
        await openOnTheWait();

        client.getAgentDeviceLoginStatus.mockRejectedValue(new WorkerError('gone', 409, 'Conflict'));
        await vi.advanceTimersByTimeAsync(DEVICE_POLL_MS);

        expect(screen.getByText(/ended before the approval landed/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Start again' })).toBeInTheDocument();
    });

    // A failed read changes nothing: it is the service that could not be reached, which says
    // nothing about the wait — so the dialog keeps waiting for the next poll.
    it('polls past an unreachable service', async () => {
        vi.useFakeTimers();
        renderSignIn();
        await openOnTheWait();

        client.getAgentDeviceLoginStatus.mockRejectedValueOnce(new Error('network down'));
        await vi.advanceTimersByTimeAsync(DEVICE_POLL_MS);
        expect(screen.getByText('Waiting for approval…')).toBeInTheDocument();
        expect(screen.queryByText('Sign-in failed')).not.toBeInTheDocument();

        client.getAgentDeviceLoginStatus.mockResolvedValueOnce({ pending: false, ok: true, message: 'Logged in.' });
        await vi.advanceTimersByTimeAsync(DEVICE_POLL_MS);
        expect(feedback.success).toHaveBeenCalledWith('Logged in.');
    });

    // A start the CLI refused fails before any wait: the dialog says why and offers another start.
    it('says a start that yielded no page', async () => {
        vi.useFakeTimers();
        client.startAgentDeviceLogin.mockResolvedValue({ ok: false, message: 'the CLI exited before printing a sign-in page' });
        renderSignIn();

        fireEvent.click(screen.getByRole('button', { name: 'Log in to Muse' }));
        await vi.advanceTimersByTimeAsync(0);

        expect(screen.getByText(/exited before printing a sign-in page/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Start again' })).toBeInTheDocument();
    });

    // The key is the alternative: one paste, one round trip, and the dialog closes on a stored key.
    // Switching to it abandons the device wait, since the two are alternatives.
    it('signs in with an API key instead', async () => {
        vi.useFakeTimers();
        client.cancelAgentDeviceLogin.mockResolvedValue({ ok: true });
        client.submitAgentApiKey.mockResolvedValue({ ok: true, message: 'credentials saved for provider meta' });
        renderSignIn();
        await openOnTheWait();

        fireEvent.click(screen.getByRole('button', { name: 'Use an API key instead' }));
        expect(client.cancelAgentDeviceLogin).toHaveBeenCalledWith('muse');

        fireEvent.change(screen.getByPlaceholderText('Paste the API key'), { target: { value: 'the-key' } });
        fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

        await vi.advanceTimersByTimeAsync(0);
        expect(client.submitAgentApiKey).toHaveBeenCalledWith('muse', 'the-key');
        expect(feedback.success).toHaveBeenCalledWith('credentials saved for provider meta');
        expect(screen.queryByTestId('login-modal')).not.toBeInTheDocument();
    });

    // A refused key is a second chance, not a closed dialog: there is no parked process between
    // two attempts, so sending again is just sending again.
    it('says a refused key and stays open for another paste', async () => {
        client.submitAgentApiKey.mockResolvedValue({ ok: false, message: 'not a key this CLI accepts' });
        renderSignIn(keyOnly);

        fireEvent.click(screen.getByRole('button', { name: 'Log in to Muse' }));
        fireEvent.change(screen.getByPlaceholderText('Paste the API key'), { target: { value: 'wrong-key' } });
        fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

        await waitFor(() => expect(screen.getByText('not a key this CLI accepts')).toBeInTheDocument());
        expect(screen.getByTestId('login-modal')).toBeInTheDocument();
        expect(feedback.success).not.toHaveBeenCalled();
    });

    // With only one shape offered, the dialog opens on it and offers no switch.
    it('opens on the one shape offered', async () => {
        renderSignIn(keyOnly);
        fireEvent.click(screen.getByRole('button', { name: 'Log in to Muse' }));
        expect(screen.getByPlaceholderText('Paste the API key')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /meta sign-in/i })).not.toBeInTheDocument();
    });

    it('offers no key where the service advertises none', async () => {
        vi.useFakeTimers();
        renderSignIn(deviceOnly);
        await openOnTheWait();
        expect(screen.queryByRole('button', { name: /api key/i })).not.toBeInTheDocument();
    });
});
