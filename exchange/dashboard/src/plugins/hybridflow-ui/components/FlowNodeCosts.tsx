import React, { useEffect, useState } from 'react';
import { Tooltip } from 'antd';
import { useHybridflowClient } from '../service/HybridflowClient-ctx';
import { FlowNodeUsageTotalsDto } from '../service/types';
import styles from '../Hybridflow.module.css';

/**
 * What an AI card spent, on its own row of the large editor: the sums of the usage reports its
 * turns filed — the cost, and the tokens in and out.
 *
 * It is read when the editor opens, and again when another card is opened in it: a usage report
 * moves nothing but itself — no change event, no revision — so there is nothing to watch, and a
 * figure that arrived mid-read is picked up the next time the editor is opened. The breakdown —
 * cache, reasoning, how many reports — rides in the tooltip, because the row is read at a glance.
 *
 * The cost is unknown where no report priced itself, and that is said out loud: an absent price is
 * not a free turn. A card whose turns filed nothing says it spent nothing yet, which is a
 * different thing from a read that failed — the service being unreachable tells us nothing about
 * the card.
 */
export const FlowNodeCosts: React.FC<{ handle: string | null; flowNodeId: string }> = ({
    handle, flowNodeId,
}) => {
    const { totals, loading, error } = useFlowNodeUsageTotals(handle, flowNodeId);

    if (loading || (!totals && !error)) {
        return <span className={styles.editorCosts}>Reading costs…</span>;
    }
    if (error || !totals) {
        return <span className={styles.editorCosts}>Costs unavailable</span>;
    }
    if (totals.reports === 0) {
        return <span className={styles.editorCosts}>Nothing spent yet</span>;
    }
    return (
        <Tooltip title={breakdown(totals)}>
            <span className={styles.editorCosts} data-testid="flow-node-costs">
                {headline(totals)}
            </span>
        </Tooltip>
    );
};

/** The row itself: the cost, and the tokens in and out. */
const headline = (totals: FlowNodeUsageTotalsDto): string => {
    const cost = totals.costUsdMicros === undefined ? 'cost unknown' : formatUsd(totals.costUsdMicros);
    return `${cost} · ${formatTokens(totals.inputTokens)} in / ${formatTokens(totals.outputTokens)} out`;
};

/** The tooltip: every column, and how many reports the sums are made of. */
const breakdown = (totals: FlowNodeUsageTotalsDto): string => {
    const lines = [
        `Input: ${formatFull(totals.inputTokens)} tokens`,
        `Output: ${formatFull(totals.outputTokens)} tokens`,
        `Cache read: ${formatFull(totals.cacheReadTokens)} tokens`,
        `Cache write: ${formatFull(totals.cacheWriteTokens)} tokens`,
        `Reasoning: ${formatFull(totals.reasoningTokens)} tokens`,
        `${totals.reports} ${totals.reports === 1 ? 'report' : 'reports'}`,
    ];
    return lines.join('\n');
};

const usd = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4,
});

/** Millionths of a dollar, as a price: `$1.23`, down to `$0.0045` before it rounds to nothing. */
const formatUsd = (micros: number): string => usd.format(micros / 1_000_000);

const compact = new Intl.NumberFormat('en-US', {
    notation: 'compact', maximumFractionDigits: 1,
});

/** Tokens at a glance: `12.4K` rather than `12,380`. */
const formatTokens = (count: number): string => compact.format(count);

const full = new Intl.NumberFormat('en-US');

/** Tokens spelled out: `12,380`, for the tooltip. */
const formatFull = (count: number): string => full.format(count);

interface UsageRead {
    totals: FlowNodeUsageTotalsDto | null;
    loading: boolean;
    error: boolean;
}

/**
 * One card's totals, read once per card. A read landing after the editor moved on to another card
 * is dropped: it answers a question nobody is asking any more.
 */
const useFlowNodeUsageTotals = (handle: string | null, flowNodeId: string): UsageRead => {
    const client = useHybridflowClient();
    const [read, setRead] = useState<UsageRead>({ totals: null, loading: true, error: false });

    useEffect(() => {
        let dropped = false;
        setRead({ totals: null, loading: true, error: false });
        if (!client || !handle) {
            setRead({ totals: null, loading: false, error: true });
            return;
        }
        client.flowNodeUsageTotals(handle, flowNodeId).then(
            totals => { if (!dropped) setRead({ totals, loading: false, error: false }); },
            () => { if (!dropped) setRead({ totals: null, loading: false, error: true }); },
        );
        return () => { dropped = true; };
    }, [client, handle, flowNodeId]);

    return read;
};
