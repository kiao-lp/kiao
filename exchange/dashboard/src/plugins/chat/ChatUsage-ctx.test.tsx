import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HarnessUsage } from 'kiao-worker';

const asked: string[] = [];
const answers: Record<string, HarnessUsage | Error> = {};

const client = {
    getHarnessUsage: (harness: string) => {
        asked.push(harness);
        const answer = answers[harness];
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
};

vi.mock('@kiao-dashboard-core', () => ({ useWorkerClient: () => client }));

import { ChatUsageProvider, useChatUsage } from './ChatUsage-ctx';

const windowsOf = (percent: number): HarnessUsage => ({
    windows: [{ windowMinutes: 300, percentUsed: percent, resetAtEpochSeconds: 1_756_100_000 }],
});

/** One usage section, reduced to the two things it shows and the one thing it does. */
const Section: React.FC<{ harness: string; at?: string }> = ({ harness, at }) => {
    const { usage, loading, error, refresh } = useChatUsage(harness);
    const name = at ?? harness;
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
    it('asks about nothing until refreshed', () => {
        answers.claude = windowsOf(42);

        render(
            <ChatUsageProvider>
                <Section harness="claude" />
                <Section harness="codex" />
            </ChatUsageProvider>,
        );

        expect(value('claude')).toBe('—');
        expect(state('claude')).toBe('empty');
        expect(state('codex')).toBe('empty');
        expect(asked).toHaveLength(0);
    });

    it('reads a harness once however many sections show it', async () => {
        answers.claude = windowsOf(42);

        render(
            <ChatUsageProvider>
                <Section harness="claude" at="one" />
                <Section harness="claude" at="two" />
            </ChatUsageProvider>,
        );
        refresh('one');

        await waitFor(() => expect(value('one')).toBe('42%'));
        expect(value('two')).toBe('42%');
        expect(asked.filter(harness => harness === 'claude')).toHaveLength(1);
    });

    // Two engines are two accounts, and the figures must not cross.
    it('reads each harness on its own', async () => {
        answers.claude = windowsOf(11);
        answers.codex = windowsOf(77);

        render(
            <ChatUsageProvider>
                <Section harness="claude" />
                <Section harness="codex" />
            </ChatUsageProvider>,
        );
        refresh('claude');
        refresh('codex');

        await waitFor(() => expect(value('claude')).toBe('11%'));
        expect(value('codex')).toBe('77%');
        expect([...asked].sort()).toEqual(['claude', 'codex']);
    });

    it('reports a failed refresh without claiming the account is empty', async () => {
        answers.claude = windowsOf(42);

        render(<ChatUsageProvider><Section harness="claude" /></ChatUsageProvider>);
        refresh('claude');
        await waitFor(() => expect(state('claude')).toBe('known'));

        answers.claude = new Error('signed out');
        refresh('claude');

        await waitFor(() => expect(state('claude')).toBe('error'));
        expect(value('claude')).toBe('42%');
    });

    it('reads a first refresh that fails as an error with nothing known', async () => {
        answers.codex = new Error('signed out');

        render(<ChatUsageProvider><Section harness="codex" /></ChatUsageProvider>);
        refresh('codex');

        await waitFor(() => expect(state('codex')).toBe('error'));
        expect(value('codex')).toBe('—');
    });
});
