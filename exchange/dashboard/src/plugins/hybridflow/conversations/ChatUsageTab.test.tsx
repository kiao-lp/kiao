import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HarnessOptions, HarnessOptionsEntry, HarnessUsage } from 'kiao-worker';

const asked: string[] = [];
const answers: Record<string, HarnessUsage | Error> = {};
let offered: HarnessOptionsEntry[] = [];

const entry = (value: string, label: string, login?: HarnessOptionsEntry['login']): HarnessOptionsEntry => ({
    value, label, models: [], efforts: [], permissionModes: [], ...(login ? { login } : {}),
});

const client = {
    getHarnessOptions: (): Promise<HarnessOptions> => Promise.resolve({
        models: [], efforts: [], permissionModes: [],
        harnesses: offered, defaultHarness: offered[0]?.value ?? '',
    }),
    getHarnessUsage: (harness: string) => {
        asked.push(harness);
        const answer = answers[harness];
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
};

vi.mock('@kiao-dashboard-core', () => ({
    useWorkerClient: () => client,
    TOOLBOX_CHANGED_EVENT: 'kiao:toolbox-changed',
}));

import { ChatUsageProvider } from './ChatUsage-ctx';
import { ChatUsageTab } from './ChatUsageTab';

const windowsOf = (percent: number): HarnessUsage => ({
    windows: [{ windowMinutes: 300, percentUsed: percent, resetAtEpochSeconds: 1_756_100_000 }],
});

const tab = () => render(
    <ChatUsageProvider>
        <ChatUsageTab />
    </ChatUsageProvider>,
);

const section = (label: string) => screen.getByRole('region', { name: label });

const shownTab = async () => {
    tab();
    await waitFor(() => {
        for (const label of ['Claude', 'Codex', 'Muse']) {
            expect(screen.getByRole('region', { name: label })).toBeInTheDocument();
        }
    });
};

beforeEach(() => {
    asked.length = 0;
    Object.keys(answers).forEach(key => delete answers[key]);
    offered = [
        entry('claude', 'Claude'),
        entry('codex', 'Codex', { methods: ['device', 'api-key'], enabled: true, hostCommand: 'codex login --device-auth' }),
        entry('muse', 'Muse', { methods: ['device', 'api-key'], enabled: true, hostCommand: 'muse login' }),
    ];
});

afterEach(() => vi.restoreAllMocks());

describe('the usage tab', () => {
    it('keeps its sections and cached usage while a toolbox change reloads the harnesses', async () => {
        answers.claude = windowsOf(42);
        await shownTab();
        fireEvent.click(screen.getByRole('button', { name: "Refresh usage for Claude" }));
        await waitFor(() => expect(within(section('Claude')).getByText('42%')).toBeInTheDocument());
        const claudeSection = section('Claude');

        let finish!: (options: HarnessOptions) => void;
        const getOptions = vi.spyOn(client, 'getHarnessOptions').mockReturnValueOnce(
            new Promise(resolve => { finish = resolve; }),
        );
        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        expect(getOptions).toHaveBeenCalledTimes(1);
        expect(section('Claude')).toBe(claudeSection);
        expect(within(claudeSection).getByText('42%')).toBeInTheDocument();
        expect(screen.getAllByRole('region')).toHaveLength(3);

        await act(async () => { finish({
            models: [], efforts: [], permissionModes: [], harnesses: offered,
        }); });
        expect(section('Claude')).toBe(claudeSection);
        expect(asked).toEqual(['claude']);
    });

    it('removes disabled harnesses and their usage and login actions from an open tab', async () => {
        await shownTab();
        offered = [];
        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        await waitFor(() => expect(screen.getByText(/No harness is enabled and available/)).toBeInTheDocument());
        expect(screen.queryAllByRole('region')).toHaveLength(0);
        expect(screen.queryByRole('button', { name: /Log in|Refresh/ })).toBeNull();
        expect(asked).toEqual([]);
    });

    it('shows every offered harness empty, and reads nothing until refreshed', async () => {
        answers.claude = windowsOf(11);
        answers.codex = windowsOf(77);
        answers.muse = windowsOf(33);

        await shownTab();

        for (const label of ['Claude', 'Codex', 'Muse']) {
            const shown = section(label);
            expect(within(shown).getByText(/Refresh to load usage/)).toBeInTheDocument();
            expect(within(shown).getByRole('button', { name: `Refresh usage for ${label}` })).toBeInTheDocument();
        }
        expect(asked).toHaveLength(0);
    });

    // Refresh reads one harness only.
    it('refreshes one harness at a time', async () => {
        answers.claude = windowsOf(11);
        answers.muse = windowsOf(33);

        await shownTab();
        fireEvent.click(screen.getByRole('button', { name: "Refresh usage for Muse" }));

        await waitFor(() => expect(within(section('Muse')).getByText('33%')).toBeInTheDocument());
        expect(within(section('Claude')).getByText(/Refresh to load usage/)).toBeInTheDocument();
        expect(asked).toEqual(['muse']);
    });

    it('says a failed refresh in its own section', async () => {
        answers.codex = new Error('signed out');

        await shownTab();
        fireEvent.click(screen.getByRole('button', { name: "Refresh usage for Codex" }));

        await waitFor(() => expect(within(section('Codex')).getByText(/Usage unavailable/)).toBeInTheDocument());
        expect(within(section('Claude')).queryByText(/Usage unavailable/)).toBeNull();
    });

    it('shows the advertised sign-in beside that harness’s refresh', async () => {
        await shownTab();

        expect(within(section('Muse')).getByRole('button', { name: 'Log in to Muse' })).toBeInTheDocument();
        expect(within(section('Claude')).queryByRole('button', { name: /log in/i })).toBeNull();
        expect(within(section('Codex')).getByRole('button', { name: 'Log in to Codex' })).toBeInTheDocument();
    });

    it('says so where no harness is installed', async () => {
        offered = [];

        tab();

        await waitFor(() => expect(screen.getByText(/No harness is enabled and available/)).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: /Refresh/ })).toBeNull();
        expect(asked).toHaveLength(0);
    });
});
