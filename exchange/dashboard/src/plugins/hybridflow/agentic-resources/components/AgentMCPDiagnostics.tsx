import React, { useEffect, useState } from 'react';
import { Alert, Button } from 'antd';
import { useWorkerClient } from '@kiao-dashboard-core';
import type { AgentMCPDiagnostic } from 'kiao-worker';
import styles from './ResourceEditor.module.css';

export const AgentMCPDiagnostics: React.FC<{ agentId: string; commit?: string; dependencyRevision: number }> = ({ agentId, commit, dependencyRevision }) => {
    const client = useWorkerClient();
    const [attempt, setAttempt] = useState(0);
    const [results, setResults] = useState<AgentMCPDiagnostic[] | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        const request = new AbortController();
        setResults(null);
        setError('');
        void client.diagnoseAgentMCP(agentId, commit, request.signal).then(diagnostics => {
            if (!request.signal.aborted) setResults(diagnostics);
        }).catch(cause => {
            if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
        });
        return () => request.abort();
    }, [agentId, attempt, client, commit, dependencyRevision]);

    const pending = results === null && !error;
    return <section aria-label="MCP diagnostics" className={styles.field}>
        <div className={styles.row}>
            <span className={styles.label}>MCP diagnostics on this runner</span>
            <Button size="small" loading={pending} onClick={() => setAttempt(value => value + 1)}>Check again</Button>
        </div>
        {pending && <span role="status">Checking MCP servers…</span>}
        {error && <Alert type="error" showIcon title={error} />}
        {results?.length === 0 && <span>No MCP servers configured.</span>}
        {results?.map(result => <Alert key={result.server} showIcon type={result.available ? 'success' : 'warning'}
            title={`${result.server} · ${result.available ? 'Available' : 'Unavailable'}`}
            description={result.available ? undefined : <div className={styles.diagnosticDetail}>
                {result.stage && <strong>{result.stage}</strong>}
                <div>{result.message}</div>
            </div>} />)}
    </section>;
};
