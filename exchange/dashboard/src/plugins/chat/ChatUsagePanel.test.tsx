import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { AgentUsage } from 'kiao-worker';

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
        expect(resets[0]).toMatch(/^reset /);
        expect(resets[0]).not.toBe(resets[1]);
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
});
