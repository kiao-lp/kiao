import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentUsage } from 'kiao-worker';
import { formatLocalDateTime } from '@cms-kit/date-time';

import { ChatUsagePanel } from './ChatUsagePanel';

// A fixed instant so the reset time is the same string in both places under test — what matters is
// that the gauge prints a reset, not what any particular clock reads.
const RESET_FIVE_HOUR = 1_756_100_000;
const RESET_WEEKLY = 1_756_500_000;

const usageOf = (fiveHour: number, weekly: number): AgentUsage => ({
    windows: [
        { windowMinutes: 300, percentUsed: fiveHour, resetAtEpochSeconds: RESET_FIVE_HOUR },
        { windowMinutes: 10080, percentUsed: weekly, resetAtEpochSeconds: RESET_WEEKLY },
    ],
});

describe('the quota gauges', () => {
    it('draws one gauge per window, labelled by its length with its percentage and reset', () => {
        const { container } = render(<ChatUsagePanel usage={usageOf(42, 7)} loading={false} error={false} />);

        expect(screen.getByText('Limite 5 h')).toBeInTheDocument();
        expect(screen.getByText('Limite 7 j')).toBeInTheDocument();
        // The percentage antd prints on the gauge itself.
        expect(container.querySelectorAll('.chat-usage-progress')).toHaveLength(2);
        expect(screen.getByText('42%')).toBeInTheDocument();
        expect(screen.getByText('7%')).toBeInTheDocument();
        const resets = [...container.querySelectorAll('.chat-usage-reset')].map(node => node.textContent ?? '');
        expect(resets).toHaveLength(2);
        expect(resets).toEqual([
            `reset ${formatLocalDateTime(RESET_FIVE_HOUR * 1000)}`,
            `reset ${formatLocalDateTime(RESET_WEEKLY * 1000)}`,
        ]);
    });

    it('turns a nearly spent window red, and leaves the other one background', () => {
        const { container } = render(<ChatUsagePanel usage={usageOf(93, 12)} loading={false} error={false} />);

        const gauges = [...container.querySelectorAll('.chat-usage-progress')];
        expect(gauges).toHaveLength(2);
        expect(gauges[0].className).toMatch(/ant-progress-status-exception/);
        expect(gauges[1].className).not.toMatch(/ant-progress-status-exception/);
    });

    // A Codex plan is not a Claude subscription: a free one has a single thirty-day window. Drawing
    // it as a pair, or labelling it "5 h" because the first window of a pair used to be, is a figure
    // about an account nobody has.
    it('draws as many gauges as the account has, named by their own length', () => {
        const monthly: AgentUsage = {
            windows: [{ windowMinutes: 43200, percentUsed: 34, resetAtEpochSeconds: RESET_WEEKLY }],
        };
        const { container } = render(<ChatUsagePanel usage={monthly} loading={false} error={false} />);

        expect(container.querySelectorAll('.chat-usage-row')).toHaveLength(1);
        expect(screen.getByText('Limite 30 j')).toBeInTheDocument();
    });

    // Three silences, and they say different things: a read on its way, an account nobody has asked
    // about yet, and one that could not be read.
    it('says what the absence of gauges means', () => {
        const { rerender } = render(<ChatUsagePanel usage={null} loading error={false} />);
        expect(screen.getByText(/Chargement/)).toBeInTheDocument();

        rerender(<ChatUsagePanel usage={null} loading={false} error={false} />);
        expect(screen.getByText(/Actualisez/)).toBeInTheDocument();

        rerender(<ChatUsagePanel usage={null} loading={false} error />);
        expect(screen.getByText(/indisponible/)).toBeInTheDocument();
    });

    // An account whose plan reports no window at all is not a service that failed — and not an
    // account nobody asked about either: it was read, and this is what it said.
    it('reads an account with no window as unavailable rather than as an empty quota', () => {
        const { container } = render(<ChatUsagePanel usage={{ windows: [] }} loading={false} error={false} />);
        expect(container.querySelector('.chat-usage-row')).toBeNull();
        expect(screen.getByText(/indisponible/)).toBeInTheDocument();
    });

    // A read that failed says nothing about the account, so the figures it did not manage to replace
    // are still the best answer there is.
    it('keeps the last known figures when a re-read fails', () => {
        render(<ChatUsagePanel usage={usageOf(42, 7)} loading={false} error />);
        expect(screen.getByText('Limite 5 h')).toBeInTheDocument();
        expect(screen.getByText('42%')).toBeInTheDocument();
    });

    it('reports a missing reset without inventing a date in 1970', () => {
        render(<ChatUsagePanel usage={{ windows: [{ windowMinutes: 300, percentUsed: 100, resetAtEpochSeconds: 0 }] }} loading={false} error={false} />);
        expect(screen.getByText('Reset time unavailable')).toBeInTheDocument();
    });
});

describe('the current-time marker', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-23T09:00:00Z'));
    });
    afterEach(() => vi.useRealTimers());

    it.each([
        [300, 50],
        [10080, 25],
        [43200, 75],
    ])('shows elapsed time in a %i-minute period independently of usage', (windowMinutes, elapsed) => {
        const usage: AgentUsage = { windows: [{
            windowMinutes, percentUsed: 42,
            resetAtEpochSeconds: Date.now() / 1000 + windowMinutes * 60 * (1 - elapsed / 100),
        }] };
        const { container } = render(<ChatUsagePanel usage={usage} loading={false} error={false} />);

        expect(container.querySelector('.chat-usage-time-rail')).toHaveStyle({
            '--chat-usage-time-position': `${elapsed}%`,
        });
        expect(screen.getByRole('progressbar', { name: new RegExp(`${elapsed} % de la période écoulée`) }))
            .toHaveAttribute('aria-valuenow', '42');
    });

    it.each([
        [360, 0],
        [300, 0],
        [0, 100],
        [-60, 100],
    ])('keeps the marker on the bar with %i minutes until reset', (remainingMinutes, elapsed) => {
        const usage: AgentUsage = { windows: [{
            windowMinutes: 300, percentUsed: 42,
            resetAtEpochSeconds: Date.now() / 1000 + remainingMinutes * 60,
        }] };
        const { container } = render(<ChatUsagePanel usage={usage} loading={false} error={false} />);

        expect(container.querySelector('.chat-usage-time-rail')).toHaveStyle({
            '--chat-usage-time-position': `${elapsed}%`,
        });
    });

    it('omits the marker when the duration or reset is unknown', () => {
        const usage: AgentUsage = { windows: [
            { windowMinutes: 0, percentUsed: 42, resetAtEpochSeconds: Date.now() / 1000 + 3600 },
            { windowMinutes: 300, percentUsed: 42, resetAtEpochSeconds: 0 },
        ] };
        const { container } = render(<ChatUsagePanel usage={usage} loading={false} error={false} />);

        expect(screen.getAllByRole('progressbar')).toHaveLength(2);
        expect(container.querySelector('.chat-usage-time-rail')).toBeNull();
    });

    it('uses the current time on refresh and advances without changing the reported usage', () => {
        const { container, rerender, unmount } = render(<ChatUsagePanel usage={null} loading={false} error={false} />);
        act(() => { vi.advanceTimersByTime(2 * 60 * 60_000); });
        const usage: AgentUsage = { windows: [{
            windowMinutes: 300, percentUsed: 42,
            resetAtEpochSeconds: Date.now() / 1000 + 150 * 60,
        }] };
        rerender(<ChatUsagePanel usage={usage} loading={false} error={false} />);
        expect(container.querySelector('.chat-usage-time-rail')).toHaveStyle({
            '--chat-usage-time-position': '50%',
        });

        act(() => { vi.advanceTimersByTime(30 * 60_000); });
        expect(container.querySelector('.chat-usage-time-rail')).toHaveStyle({
            '--chat-usage-time-position': '60%',
        });
        expect(screen.getByText('42%')).toBeInTheDocument();

        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});
