import React, { useEffect, useState } from 'react';
import { Tooltip } from 'antd';
import { useHybridflowClient } from '../service/HybridflowClient-ctx';
import { FlowNodeUsageTotalsDto } from '../service/types';
import styles from '../Hybridflow.module.css';

/** AI node cost row. */
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

const headline = (totals: FlowNodeUsageTotalsDto): string => {
    const cost = totals.costUsdMicros === undefined ? 'cost unknown' : formatUsd(totals.costUsdMicros);
    return `${cost} · ${formatTokens(totals.inputTokens)} in / ${formatTokens(totals.outputTokens)} out`;
};

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

/** Format micro-dollars as USD. */
const formatUsd = (micros: number): string => usd.format(micros / 1_000_000);

const compact = new Intl.NumberFormat('en-US', {
    notation: 'compact', maximumFractionDigits: 1,
});

const formatTokens = (count: number): string => compact.format(count);

const full = new Intl.NumberFormat('en-US');

const formatFull = (count: number): string => full.format(count);

interface UsageRead {
    totals: FlowNodeUsageTotalsDto | null;
    loading: boolean;
    error: boolean;
}

/** Fetch totals once per node; drop stale results. */
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
