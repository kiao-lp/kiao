import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentOptionsEntry, AgentUsage } from 'kiao-worker';

// What the deployment offers, and what each account answers. Both recorded, because what is
// interesting is which agent a refresh asked about — not the shape of either request.
const asked: string[] = [];
const answers: Record<string, AgentUsage | Error> = {};
let offered: AgentOptionsEntry[] = [];

const entry = (value: string, label: string, login?: AgentOptionsEntry['login']): AgentOptionsEntry => ({
    value, label, models: [], efforts: [], permissionModes: [], ...(login ? { login } : {}),
});

const client = {
    getAgentOptions: () => Promise.resolve({
        models: [], efforts: [], permissionModes: [],
        agents: offered, defaultAgent: offered[0]?.value ?? '',
    }),
    getAgentUsage: (agent: string) => {
        asked.push(agent);
        const answer = answers[agent];
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
};

vi.mock('@cms-core', () => ({
    useWorkerClient: () => client,
    TOOLBOX_CHANGED_EVENT: 'kiao:toolbox-changed',
}));

import { ChatUsageProvider } from './ChatUsage-ctx';
import { ChatUsageTab } from './ChatUsageTab';

const windowsOf = (percent: number): AgentUsage => ({
    windows: [{ windowMinutes: 300, percentUsed: percent, resetAtEpochSeconds: 1_756_100_000 }],
});

const tab = () => render(
    <ChatUsageProvider>
        <ChatUsageTab />
    </ChatUsageProvider>,
);

const section = (label: string) => screen.getByRole('region', { name: label });

// The tab with its sections on screen: the offered agents arrive one tick after mount, and only
// then is a section there to be refreshed.
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
        entry('codex', 'Codex'),
        entry('muse', 'Muse', { methods: ['device', 'api-key'], enabled: true, hostCommand: 'muse login' }),
    ];
});

describe('the usage tab', () => {
    it('removes disabled agents and their usage and login actions from an open tab', async () => {
        await shownTab();
        offered = [];
        act(() => { window.dispatchEvent(new Event('kiao:toolbox-changed')); });
        await waitFor(() => expect(screen.getByText(/No agent is enabled and available/)).toBeInTheDocument());
        expect(screen.queryAllByRole('region')).toHaveLength(0);
        expect(screen.queryByRole('button', { name: /Log in|Actualiser/ })).toBeNull();
        expect(asked).toEqual([]);
    });

    // One section per agent the deployment offers, each with its own refresh — and every one of
    // them empty until its refresh is pressed. Opening the tab puts no usage read on the wire.
    it('shows every offered agent empty, and reads nothing until refreshed', async () => {
        answers.claude = windowsOf(11);
        answers.codex = windowsOf(77);
        answers.muse = windowsOf(33);

        await shownTab();

        for (const label of ['Claude', 'Codex', 'Muse']) {
            const shown = section(label);
            expect(within(shown).getByText(/Actualisez pour lire/)).toBeInTheDocument();
            expect(within(shown).getByRole('button', { name: `Actualiser l'usage ${label}` })).toBeInTheDocument();
        }
        expect(asked).toHaveLength(0);
    });

    // A refresh reads that agent's account only: asking about Muse spends nothing of Claude's, and
    // the sections beside it stay exactly as they were.
    it('refreshes one agent at a time', async () => {
        answers.claude = windowsOf(11);
        answers.muse = windowsOf(33);

        await shownTab();
        fireEvent.click(screen.getByRole('button', { name: "Actualiser l'usage Muse" }));

        await waitFor(() => expect(within(section('Muse')).getByText('33%')).toBeInTheDocument());
        expect(within(section('Claude')).getByText(/Actualisez pour lire/)).toBeInTheDocument();
        expect(asked).toEqual(['muse']);
    });

    // A read that failed is said in that section, beside a refresh to try again — and nowhere else.
    it('says a failed refresh in its own section', async () => {
        answers.codex = new Error('signed out');

        await shownTab();
        fireEvent.click(screen.getByRole('button', { name: "Actualiser l'usage Codex" }));

        await waitFor(() => expect(within(section('Codex')).getByText(/indisponible/)).toBeInTheDocument());
        expect(within(section('Claude')).queryByText(/indisponible/)).toBeNull();
    });

    // The sign-in the service advertises for an agent sits beside its refresh — and only there:
    // an agent with no offer has no button.
    it('shows the advertised sign-in beside that agent’s refresh', async () => {
        await shownTab();

        expect(within(section('Muse')).getByRole('button', { name: 'Log in to Muse' })).toBeInTheDocument();
        expect(within(section('Claude')).queryByRole('button', { name: /log in/i })).toBeNull();
        expect(within(section('Codex')).queryByRole('button', { name: /log in/i })).toBeNull();
    });

    // A machine with no agent on it has no usage to show. Said once for the tab rather than once
    // per section, since there are no sections.
    it('says so where no agent is installed', async () => {
        offered = [];

        tab();

        await waitFor(() => expect(screen.getByText(/No agent is enabled and available/)).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: /Actualiser/ })).toBeNull();
        expect(asked).toHaveLength(0);
    });
});
