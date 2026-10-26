import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentUsage } from 'kiao-worker';

// The one thing this provider talks to. Recorded rather than asserted on call, because what is
// interesting is *which agents* were asked about and how many times — not the shape of a request.
const asked: string[] = [];
const answers: Record<string, AgentUsage | Error> = {};

// One object, as the real hook hands out: a client rebuilt on every render would make "how many
// times was this agent asked about" a question about renders rather than about refreshes.
const client = {
    getAgentUsage: (agent: string) => {
        asked.push(agent);
        const answer = answers[agent];
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
};

vi.mock('@cms-core', () => ({ useWorkerClient: () => client }));

import { ChatUsageProvider, useChatUsage } from './ChatUsage-ctx';

const windowsOf = (percent: number): AgentUsage => ({
    windows: [{ windowMinutes: 300, percentUsed: percent, resetAtEpochSeconds: 1_756_100_000 }],
});

/** One usage section, reduced to the two things it shows and the one thing it does. */
const Section: React.FC<{ agent: string; at?: string }> = ({ agent, at }) => {
    const { usage, loading, error, refresh } = useChatUsage(agent);
    const name = at ?? agent;
    return (
        <div>
            <div data-testid={`value-${name}`}>{usage ? `${usage.windows[0]?.percentUsed}%` : '—'}</div>
            <div data-testid={`state-${name}`}>
                {loading ? 'loading' : error ? 'error' : usage ? 'known' : 'empty'}
            </div>
            <button data-testid={`refresh-${name}`} onClick={() => void refresh()}>refresh</button>
        </div>
    );
};

const value = (section: string) => screen.getByTestId(`value-${section}`).textContent;
const state = (section: string) => screen.getByTestId(`state-${section}`).textContent;
const refresh = (section: string) => fireEvent.click(screen.getByTestId(`refresh-${section}`));

beforeEach(() => {
    asked.length = 0;
    Object.keys(answers).forEach(key => delete answers[key]);
});

describe('the quota, read by hand', () => {
    // Nothing is read until it is asked for: every section starts empty, and mounting the panel
    // puts nothing on the wire.
    it('asks about nothing until refreshed', () => {
        answers.claude = windowsOf(42);

        render(
            <ChatUsageProvider>
                <Section agent="claude" />
                <Section agent="codex" />
            </ChatUsageProvider>,
        );

        expect(value('claude')).toBe('—');
        expect(state('claude')).toBe('empty');
        expect(state('codex')).toBe('empty');
        expect(asked).toHaveLength(0);
    });

    // The whole point of one state per agent: two sections on one engine are one request, and the
    // answer is what both of them show.
    it('reads an agent once however many sections show it', async () => {
        answers.claude = windowsOf(42);

        render(
            <ChatUsageProvider>
                <Section agent="claude" at="one" />
                <Section agent="claude" at="two" />
            </ChatUsageProvider>,
        );
        refresh('one');

        await waitFor(() => expect(value('one')).toBe('42%'));
        expect(value('two')).toBe('42%');
        expect(asked.filter(agent => agent === 'claude')).toHaveLength(1);
    });

    // Two engines are two accounts, and the figures must not cross.
    it('reads each agent on its own', async () => {
        answers.claude = windowsOf(11);
        answers.codex = windowsOf(77);

        render(
            <ChatUsageProvider>
                <Section agent="claude" />
                <Section agent="codex" />
            </ChatUsageProvider>,
        );
        refresh('claude');
        refresh('codex');

        await waitFor(() => expect(value('claude')).toBe('11%'));
        expect(value('codex')).toBe('77%');
        expect([...asked].sort()).toEqual(['claude', 'codex']);
    });

    // A read that failed says nothing about the account. The service was unreachable; the quota is
    // whatever it was.
    it('reports a failed refresh without claiming the account is empty', async () => {
        answers.claude = windowsOf(42);

        render(<ChatUsageProvider><Section agent="claude" /></ChatUsageProvider>);
        refresh('claude');
        await waitFor(() => expect(state('claude')).toBe('known'));

        answers.claude = new Error('signed out');
        refresh('claude');

        await waitFor(() => expect(state('claude')).toBe('error'));
        expect(value('claude')).toBe('42%');
    });

    // …and where nothing was ever known, the failure is all there is to show.
    it('reads a first refresh that fails as an error with nothing known', async () => {
        answers.codex = new Error('signed out');

        render(<ChatUsageProvider><Section agent="codex" /></ChatUsageProvider>);
        refresh('codex');

        await waitFor(() => expect(state('codex')).toBe('error'));
        expect(value('codex')).toBe('—');
    });
});
