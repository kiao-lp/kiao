import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

/**
 * What an AI card spent, as the large editor shows it: the cost, and the tokens in and out.
 *
 * The figures are the service's sums of the card's usage reports; the breakdown rides in the
 * tooltip. Three states beside the figures: nothing filed yet, a read that failed, and the one
 * the tooltip never shows — a cost no report priced, which is unknown and said so.
 */

import { FlowNodeCosts } from './FlowNodeCosts';
import { FakeHybridflowClient, HybridflowClientProvider } from '../service';
import { readBoardContent } from '../boardContent';

let service: FakeHybridflowClient;

const show = (flowNodeId = 'node-1') => render(
    <HybridflowClientProvider client={service.asClient()}>
        <FlowNodeCosts handle="major" flowNodeId={flowNodeId} />
    </HybridflowClientProvider>,
);

beforeEach(() => {
    service = new FakeHybridflowClient(readBoardContent({ flowNodes: [] }));
});

describe('FlowNodeCosts', () => {
    it('shows the cost and the tokens the card spent', async () => {
        service.usageTotalsByFlowNode['node-1'] = {
            reports: 2, inputTokens: 12400, outputTokens: 3100,
            cacheReadTokens: 8000, cacheWriteTokens: 1200, reasoningTokens: 500,
            costUsdMicros: 1_230_000,
        };
        show();

        const costs = await screen.findByTestId('flow-node-costs');
        expect(costs.textContent).toBe('$1.23 · 12.4K in / 3.1K out');
        expect(service.calls).toContain('flowNodeUsageTotals major node-1');
    });

    it('spells the full breakdown in the tooltip', async () => {
        service.usageTotalsByFlowNode['node-1'] = {
            reports: 2, inputTokens: 12400, outputTokens: 3100,
            cacheReadTokens: 8000, cacheWriteTokens: 1200, reasoningTokens: 500,
            costUsdMicros: 1_230_000,
        };
        show();

        fireEvent.mouseOver(await screen.findByTestId('flow-node-costs'));
        await waitFor(() => expect(screen.getByText(/Cache read: 8,000 tokens/)).toBeTruthy());
        expect(screen.getByText(/Reasoning: 500 tokens/).textContent).toMatch(/2 reports/);
    });

    it('says the cost is unknown where no report priced itself', async () => {
        service.usageTotalsByFlowNode['node-1'] = {
            reports: 1, inputTokens: 500, outputTokens: 100,
            cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0,
        };
        show();

        const costs = await screen.findByTestId('flow-node-costs');
        expect(costs.textContent).toBe('cost unknown · 500 in / 100 out');
    });

    it('says so where the card spent nothing yet', async () => {
        show();

        await waitFor(() => expect(screen.getByText('Nothing spent yet')).toBeTruthy());
        expect(screen.queryByTestId('flow-node-costs')).toBeNull();
    });

    it('says so where the read failed', async () => {
        service.flowNodeUsageTotals = () => Promise.reject(new Error('the store is down'));
        show();

        await waitFor(() => expect(screen.getByText('Costs unavailable')).toBeTruthy());
        expect(screen.queryByTestId('flow-node-costs')).toBeNull();
    });

    it('reads again when another card is opened in the editor', async () => {
        service.usageTotalsByFlowNode['node-1'] = {
            reports: 1, inputTokens: 500, outputTokens: 100,
            cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0,
            costUsdMicros: 50_000,
        };
        service.usageTotalsByFlowNode['node-2'] = {
            reports: 3, inputTokens: 9000, outputTokens: 2000,
            cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0,
            costUsdMicros: 400_000,
        };
        const shown = show('node-1');
        await screen.findByTestId('flow-node-costs');

        shown.rerender(
            <HybridflowClientProvider client={service.asClient()}>
                <FlowNodeCosts handle="major" flowNodeId="node-2" />
            </HybridflowClientProvider>,
        );

        await waitFor(() => expect(
            screen.getByTestId('flow-node-costs').textContent,
        ).toBe('$0.40 · 9K in / 2K out'));
    });
});
