import { render, screen, waitFor } from '@testing-library/react';
import { WorkerClientMockProvider, WorkerError } from 'kiao-worker';
import { WorkerClient } from 'kiao-worker';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import {
    DashboardConfigProvider,
    useDashboardConfig,
    normalizeConfig,
    DEFAULT_CONFIG,
    DASHBOARD_CONFIG_DOC,
} from './DashboardConfig-ctx';

const mockFilesystemService = {
    getConfigJson: vi.fn(),
    saveConfigJson: vi.fn(),
} as unknown as WorkerClient;

const Probe = () => {
    const { chatEnabled, gitEnabled } = useDashboardConfig();
    return <span data-testid="flags">{`${chatEnabled}|${gitEnabled}`}</span>;
};

const renderProvider = () =>
    render(
        <WorkerClientMockProvider mock={{ workerClient: mockFilesystemService }}>
            <DashboardConfigProvider>
                <Probe />
            </DashboardConfigProvider>
        </WorkerClientMockProvider>
    );

describe('normalizeConfig', () => {
    const flags = ({ chatEnabled, gitEnabled }: ReturnType<typeof normalizeConfig>) =>
        ({ chatEnabled, gitEnabled });

    it('defaults missing keys to enabled', () => {
        expect(flags(normalizeConfig({}))).toEqual({ chatEnabled: true, gitEnabled: true });
        expect(flags(normalizeConfig(undefined))).toEqual({ chatEnabled: true, gitEnabled: true });
        expect(flags(normalizeConfig({ gitEnabled: false })))
            .toEqual({ chatEnabled: true, gitEnabled: false });
    });

    it('only an explicit false disables a flag', () => {
        expect(flags(normalizeConfig({ chatEnabled: false, gitEnabled: false })))
            .toEqual({ chatEnabled: false, gitEnabled: false });
    });

    // A store's config document outlives the build that wrote it. The flag was `agentEnabled`,
    // and `claudeCodeEnabled` before that when the only agent was Claude, and a store still saying
    // either is still saying what it meant.
    it('reads the names the flag had before it was the panel’s', () => {
        expect(normalizeConfig({ agentEnabled: false }).chatEnabled).toBe(false);
        expect(normalizeConfig({ agentEnabled: true }).chatEnabled).toBe(true);
        expect(normalizeConfig({ claudeCodeEnabled: false }).chatEnabled).toBe(false);
        expect(normalizeConfig({ claudeCodeEnabled: true }).chatEnabled).toBe(true);
    });

    // Same for the plugin the flag turns off: a store naming `agent` — or `claude` from before
    // that — is naming the panel it has always meant, and gets it under the name that panel now has.
    it('reads the plugin under the name it had', () => {
        expect(normalizeConfig({ plugins: ['tags', 'agent'] }).plugins).toEqual(['tags', 'chat']);
        expect(normalizeConfig({ plugins: ['tags', 'claude'] }).plugins).toEqual(['tags', 'chat']);
    });

    // The video player became an editor when it learnt to cut a video into segments: a store that
    // switched the player on gets what the player became.
    it('reads the video player under the name of the editor it became', () => {
        expect(normalizeConfig({ plugins: ['movie-view', 'pdf-view'] }).plugins).toEqual(['movie-edit', 'pdf-view']);
    });

    // The tasks board became the HybridFlow UI: a store that switched the board on gets what the
    // board became.
    it('reads the tasks board under the name of the UI it became', () => {
        expect(normalizeConfig({ plugins: ['tasks-board', 'pdf-view'] }).plugins).toEqual(['hybridflow-ui', 'pdf-view']);
    });

    // The plugin list is not a flag, and does not read like one. A store that has never been asked
    // gets everything the build carries; a store that answered "none" is a store that answered.
    it('gives a store that names no plugins everything the build carries', () => {
        expect(normalizeConfig({}).plugins).toEqual(DEFAULT_CONFIG.plugins);
        expect(normalizeConfig({ plugins: undefined }).plugins).toEqual(DEFAULT_CONFIG.plugins);
    });

    it('honours an empty list as the choice it is', () => {
        expect(normalizeConfig({ plugins: [] }).plugins).toEqual([]);
    });

    it('keeps the order the store named them in', () => {
        expect(normalizeConfig({ plugins: ['tags', 'code-edit'] }).plugins)
            .toEqual(['tags', 'code-edit']);
    });
});

describe('DashboardConfigProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('applies an existing config document', async () => {
        (mockFilesystemService.getConfigJson as any).mockResolvedValue({ chatEnabled: false, gitEnabled: true });

        renderProvider();

        await waitFor(() => expect(screen.getByTestId('flags').textContent).toBe('false|true'));
        expect(mockFilesystemService.saveConfigJson).not.toHaveBeenCalled();
    });

    it('seeds defaults when the document is missing (404)', async () => {
        (mockFilesystemService.getConfigJson as any).mockRejectedValue(
            new WorkerError('Get config document failed: Not Found', 404, 'Not Found')
        );
        (mockFilesystemService.saveConfigJson as any).mockResolvedValue(undefined);

        renderProvider();

        await waitFor(() =>
            expect(mockFilesystemService.saveConfigJson).toHaveBeenCalledWith(DASHBOARD_CONFIG_DOC, DEFAULT_CONFIG)
        );
        await waitFor(() => expect(screen.getByTestId('flags').textContent).toBe('true|true'));
    });

    it('fails open with defaults on a non-404 error (e.g. backend down)', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        (mockFilesystemService.getConfigJson as any).mockRejectedValue(
            new WorkerError('Get config document failed: Service Unavailable', 503, 'Service Unavailable')
        );

        renderProvider();

        await waitFor(() => expect(screen.getByTestId('flags').textContent).toBe('true|true'));
        expect(mockFilesystemService.saveConfigJson).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});
