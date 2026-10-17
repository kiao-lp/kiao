import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkerClientMockProvider } from 'kiao-worker';
import type { WorkerClient } from 'kiao-worker';

import { RunnersProvider } from '../Runners-ctx';
import { RunnersPanel } from './RunnersPanel';
import { FakeHybridflowClient, HybridflowClientProvider } from '../service';
import { readBoardContent } from '../boardContent';

let service: FakeHybridflowClient;

// The service behind the page: which runner it beats as, and the document "it's me" writes.
// Uncast, so the tests keep the mocks' types; the provider takes the cast instead.
const filesMock = {
    getRunnerIdentity: vi.fn(),
    saveConfigJson: vi.fn(),
};
const workerClient = filesMock as unknown as WorkerClient;

const show = () => render(
    <WorkerClientMockProvider mock={{ workerClient }}>
        <HybridflowClientProvider client={service.asClient()}>
            <RunnersProvider>
                <RunnersPanel />
            </RunnersProvider>
        </HybridflowClientProvider>
    </WorkerClientMockProvider>,
);

const runnerOf = (name: string, over: Record<string, unknown> = {}) => ({
    id: `runner-${name}`, name,
    createdAt: '', updatedAt: '', revision: 1, ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    service = new FakeHybridflowClient(readBoardContent({ flowNodes: [] }));
    // Implementations survive clearAllMocks; without the reset the claim test's would leak.
    filesMock.saveConfigJson.mockReset();
    filesMock.getRunnerIdentity.mockReset();
    filesMock.getRunnerIdentity.mockResolvedValue({ runnerId: '', source: 'none' });
});

describe('RunnersPanel', () => {
    it('lists the runners the service holds', async () => {
        service.runnersList = [runnerOf('Server'), runnerOf('Desktop')];
        show();

        await waitFor(() => expect(screen.getAllByTestId('runner-card')).toHaveLength(2));
        expect(screen.getByDisplayValue('Server')).toBeTruthy();
        expect(screen.getByDisplayValue('Desktop')).toBeTruthy();
    });

    it('says so where the store holds none yet', async () => {
        show();

        await waitFor(() => expect(screen.getByText(/No runners yet/)).toBeTruthy());
    });

    it('says so where no hybridflow store is configured', () => {
        render(
            <WorkerClientMockProvider mock={{ workerClient }}>
                <RunnersPanel />
            </WorkerClientMockProvider>,
        );

        expect(screen.getByText('No hybridflow store')).toBeTruthy();
        expect(screen.queryByTestId('runner-card')).toBeNull();
    });

    it('files the runner the creator names', async () => {
        show();
        await waitFor(() => expect(screen.getByText(/No runners yet/)).toBeTruthy());

        fireEvent.click(screen.getByTestId('new-runner'));
        fireEvent.change(screen.getByTestId('new-runner-name'), { target: { value: 'Server' } });
        fireEvent.click(screen.getByTestId('create-runner'));

        await waitFor(() => expect(screen.getByDisplayValue('Server')).toBeTruthy());
        expect(service.calls).toContainEqual(expect.stringMatching(/^createRunner Server/));
    });

    it('files nothing until the creator names a name', async () => {
        show();
        await waitFor(() => expect(screen.getByText(/No runners yet/)).toBeTruthy());

        fireEvent.click(screen.getByTestId('new-runner'));
        expect(screen.getByTestId('create-runner')).toBeDisabled();

        fireEvent.change(screen.getByTestId('new-runner-name'), { target: { value: 'Server' } });
        expect(screen.getByTestId('create-runner')).toBeEnabled();
    });

    it('renames a runner where it stands', async () => {
        service.runnersList = [runnerOf('Server')];
        show();
        await waitFor(() => expect(screen.getAllByTestId('runner-card')).toHaveLength(1));

        const box = screen.getByTestId('runner-name');
        fireEvent.change(box, { target: { value: 'Desktop' } });
        fireEvent.blur(box);

        await waitFor(() => expect(service.runnersList[0].name).toBe('Desktop'));
        expect(service.calls).toContainEqual(expect.stringMatching(/^patchRunner runner-Server name/));
    });

    it('deletes a runner that is confirmed', async () => {
        service.runnersList = [runnerOf('Server')];
        show();
        await waitFor(() => expect(screen.getAllByTestId('runner-card')).toHaveLength(1));

        fireEvent.click(screen.getByTestId('delete-runner'));
        fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(service.runnersList).toHaveLength(0));
        expect(service.calls).toContainEqual(expect.stringMatching(/^deleteRunner runner-Server/));
    });

    it('reads the list again when asked', async () => {
        service.runnersList = [runnerOf('Server')];
        show();
        await waitFor(() => expect(screen.getAllByTestId('runner-card')).toHaveLength(1));

        service.runnersList = [...service.runnersList, runnerOf('Desktop')];
        fireEvent.click(screen.getByRole('button', { name: 'Refresh runners' }));

        await waitFor(() => expect(screen.getAllByTestId('runner-card')).toHaveLength(2));
    });

    it('shows when each runner was last seen', async () => {
        service.runnersList = [
            runnerOf('Server', { lastSeen: new Date(Date.now() - 20_000).toISOString() }),
            runnerOf('Quiet', { lastSeen: new Date(Date.now() - 5 * 60_000).toISOString() }),
            runnerOf('Gone'),
        ];
        show();
        await waitFor(() => expect(screen.getAllByTestId('runner-card')).toHaveLength(3));

        const lines = screen.getAllByTestId('runner-last-seen').map(line => line.textContent);
        expect(lines).toContain('Last seen just now');
        expect(lines).toContain('Last seen 5 min ago');
        expect(lines).toContain('Never seen');
    });

    it('marks the runner this machine beats as, and offers it\'s me on the rest', async () => {
        filesMock.getRunnerIdentity.mockResolvedValue({ runnerId: 'runner-Server', source: 'file' });
        service.runnersList = [runnerOf('Server'), runnerOf('Desktop')];
        show();
        await waitFor(() => expect(screen.getAllByTestId('runner-card')).toHaveLength(2));
        await waitFor(() => expect(screen.getByTestId('runner-is-me')).toBeTruthy());

        const cards = screen.getAllByTestId('runner-card');
        expect(cards[0].textContent).toContain('This machine');
        expect(cards[0].querySelector('[data-testid="its-me"]')).toBeNull();
        expect(cards[1].querySelector('[data-testid="its-me"]')).toBeTruthy();
    });

    it('names this machine the runner it\'s me is pressed on', async () => {
        service.runnersList = [runnerOf('Server'), runnerOf('Desktop')];
        filesMock.saveConfigJson.mockImplementation(async () => {
            filesMock.getRunnerIdentity.mockResolvedValue({ runnerId: 'runner-Server', source: 'file' });
        });
        show();
        await waitFor(() => expect(screen.getAllByTestId('its-me')).toHaveLength(2));

        fireEvent.click(screen.getAllByTestId('its-me')[0]);

        await waitFor(() => expect(filesMock.saveConfigJson).toHaveBeenCalledWith(
            'runner.json', { runnerId: 'runner-Server' }));
        // The mark moves without a reload: the save is re-read, not assumed.
        await waitFor(() => expect(screen.getByTestId('runner-is-me')).toBeTruthy());
        expect(screen.getAllByTestId('runner-card')[0].textContent).toContain('This machine');
    });

    it('offers nothing where the service predates the question', async () => {
        filesMock.getRunnerIdentity.mockRejectedValue(new Error('not found'));
        service.runnersList = [runnerOf('Server')];
        show();
        await waitFor(() => expect(screen.getAllByTestId('runner-card')).toHaveLength(1));
        await waitFor(() => expect(filesMock.getRunnerIdentity).toHaveBeenCalled());

        expect(screen.queryByTestId('its-me')).toBeNull();
        expect(screen.queryByTestId('runner-is-me')).toBeNull();
    });

    it('keeps the button off where the environment pinned the runner', async () => {
        filesMock.getRunnerIdentity.mockResolvedValue({ runnerId: 'runner-Server', source: 'env' });
        service.runnersList = [runnerOf('Server'), runnerOf('Desktop')];
        show();
        await waitFor(() => expect(screen.getAllByTestId('its-me')).toHaveLength(1));

        expect(screen.getByTestId('its-me')).toBeDisabled();
        expect(screen.getByTestId('runner-is-me')).toBeTruthy();
    });
});
