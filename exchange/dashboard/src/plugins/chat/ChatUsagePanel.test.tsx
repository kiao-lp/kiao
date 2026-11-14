import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HarnessUsage } from 'kiao-worker';
import { formatLocalDateTime } from '@kiao-dashboard-kit/date-time';

import { ChatUsagePanel } from './ChatUsagePanel';

const RESET_FIVE_HOUR = 1_756_100_000;
const RESET_WEEKLY = 1_756_500_000;

const usageOf = (fiveHour: number, weekly: number): HarnessUsage => ({
    windows: [
        { windowMinutes: 300, percentUsed: fiveHour, resetAtEpochSeconds: RESET_FIVE_HOUR },
        { windowMinutes: 10080, percentUsed: weekly, resetAtEpochSeconds: RESET_WEEKLY },
    ],
});

describe('the quota gauges', () => {
    it('draws one gauge per window, labelled by its length with its percentage and reset', () => {
        const { container } = render(<ChatUsagePanel usage={usageOf(42, 7)} loading={false} error={false} />);

        expect(screen.getByText('Limit 5h')).toBeInTheDocument();
        expect(screen.getByText('Limit 7d')).toBeInTheDocument();
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

    it('puts the limit title above the bar', () => {
        const { container } = render(<ChatUsagePanel usage={usageOf(42, 7)} loading={false} error={false} />);
        const label = screen.getByText('Limit 5h');
        const bar = container.querySelector('.chat-usage-progress');
        expect(bar).not.toBeNull();
        expect(label.compareDocumentPosition(bar as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(label.closest('.chat-usage-row-main')?.contains(bar)).toBe(true);
    });

    it('turns a nearly spent window red, and leaves the other one background', () => {
        const { container } = render(<ChatUsagePanel usage={usageOf(93, 12)} loading={false} error={false} />);

        const gauges = [...container.querySelectorAll('.chat-usage-progress')];
        expect(gauges).toHaveLength(2);
        expect(gauges[0].className).toMatch(/ant-progress-status-exception/);
        expect(gauges[1].className).not.toMatch(/ant-progress-status-exception/);
    });

    // A free Codex plan has a single 30-day window.
    it('draws as many gauges as the account has, named by their own length', () => {
        const monthly: HarnessUsage = {
            windows: [{ windowMinutes: 43200, percentUsed: 34, resetAtEpochSeconds: RESET_WEEKLY }],
        };
        const { container } = render(<ChatUsagePanel usage={monthly} loading={false} error={false} />);

        expect(container.querySelectorAll('.chat-usage-row')).toHaveLength(1);
        expect(screen.getByText('Limit 30d')).toBeInTheDocument();
    });

    it('says what the absence of gauges means', () => {
        const { rerender } = render(<ChatUsagePanel usage={null} loading error={false} />);
        expect(screen.getByText(/Loading usage/)).toBeInTheDocument();

        rerender(<ChatUsagePanel usage={null} loading={false} error={false} />);
        expect(screen.getByText(/Refresh to load usage/)).toBeInTheDocument();

        rerender(<ChatUsagePanel usage={null} loading={false} error />);
        expect(screen.getByText(/Usage unavailable/)).toBeInTheDocument();
    });

    it('reads an account with no window as unavailable rather than as an empty quota', () => {
        const { container } = render(<ChatUsagePanel usage={{ windows: [] }} loading={false} error={false} />);
        expect(container.querySelector('.chat-usage-row')).toBeNull();
        expect(screen.getByText(/Usage unavailable/)).toBeInTheDocument();
    });

    it('keeps the last known figures when a re-read fails', () => {
        render(<ChatUsagePanel usage={usageOf(42, 7)} loading={false} error />);
        expect(screen.getByText('Limit 5h')).toBeInTheDocument();
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
        const usage: HarnessUsage = { windows: [{
            windowMinutes, percentUsed: 42,
            resetAtEpochSeconds: Date.now() / 1000 + windowMinutes * 60 * (1 - elapsed / 100),
        }] };
        const { container } = render(<ChatUsagePanel usage={usage} loading={false} error={false} />);

        expect(container.querySelector('.chat-usage-time-rail')).toHaveStyle({
            '--chat-usage-time-position': `${elapsed}%`,
        });
        expect(screen.getByRole('progressbar', { name: new RegExp(`${elapsed}% of the period elapsed`) }))
            .toHaveAttribute('aria-valuenow', '42');
    });

    it.each([
        [360, 0],
        [300, 0],
        [0, 100],
        [-60, 100],
    ])('keeps the marker on the bar with %i minutes until reset', (remainingMinutes, elapsed) => {
        const usage: HarnessUsage = { windows: [{
            windowMinutes: 300, percentUsed: 42,
            resetAtEpochSeconds: Date.now() / 1000 + remainingMinutes * 60,
        }] };
        const { container } = render(<ChatUsagePanel usage={usage} loading={false} error={false} />);

        expect(container.querySelector('.chat-usage-time-rail')).toHaveStyle({
            '--chat-usage-time-position': `${elapsed}%`,
        });
    });

    it('omits the marker when the duration or reset is unknown', () => {
        const usage: HarnessUsage = { windows: [
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
        const usage: HarnessUsage = { windows: [{
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
