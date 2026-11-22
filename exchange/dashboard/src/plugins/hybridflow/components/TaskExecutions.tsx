import React, { useEffect, useState } from 'react';
import { Alert, Typography } from 'antd';
import { useHybridflowClient } from '../service';
import type { TaskExecutionDto } from '../service/types';

export const TaskExecutions: React.FC<{ handle: string; id: string; refreshKey: string }> = ({ handle, id, refreshKey }) => {
    const client = useHybridflowClient();
    const [open, setOpen] = useState(false);
    const [executions, setExecutions] = useState<TaskExecutionDto[]>([]);
    const [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        if (client && open) void client.taskExecutions(handle, id).then(list => {
            if (active) { setExecutions(list); setError(''); }
        }).catch(cause => { if (active) setError(String(cause)); });
        return () => { active = false; };
    }, [client, open, handle, id, refreshKey]);
    return <details onToggle={event => setOpen(event.currentTarget.open)}>
        <summary>Executions</summary>
        {error && <Alert type="error" message={error} />}
        {open && executions.length === 0 && !error && <p>No execution recorded.</p>}
        {executions.map(execution => <div key={execution.id} style={{ margin: '12px 0' }}>
            <p>{new Date(execution.at).toLocaleString()} · {execution.agent.name}</p>
            <p>{execution.harness} · {execution.model} · {execution.effort}</p>
            <Typography.Text code>{execution.agent.commit}</Typography.Text>
            <p>{execution.runnerId} · {execution.conversationId} · {execution.turnId}</p>
            <details><summary>Configuration</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(execution.agent, null, 2)}</pre></details>
        </div>)}
    </details>;
};
