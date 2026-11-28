import React, { useEffect, useState } from 'react';
import { Alert, Typography } from 'antd';
import { AsyncList } from '@kiao-dashboard-core';
import { useHybridflowClient } from '../service';
import type { TaskExecutionDto } from '../service/types';

export const TaskExecutions: React.FC<{ handle: string; id: string; refreshKey: string }> = ({ handle, id, refreshKey }) => {
    const client = useHybridflowClient();
    const [open, setOpen] = useState(false);
    const [executions, setExecutions] = useState<TaskExecutionDto[] | null>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        if (!client || !open) return;
        let active = true;
        setExecutions(previous => previous?.length ? previous : null);
        setError('');
        void client.taskExecutions(handle, id)
            .then(list => { if (active) setExecutions(list); })
            .catch(cause => { if (active) setError(String(cause)); });
        return () => { active = false; };
    }, [client, open, handle, id, refreshKey]);
    return <details onToggle={event => setOpen(event.currentTarget.open)}>
        <summary>Executions</summary>
        {open && <>
            {!!executions?.length && error && <Alert type="error" showIcon title={error} />}
            <AsyncList loading={!!client && executions === null} error={!executions?.length && error}
                empty={!executions?.length && 'No execution recorded.'}>
                {executions?.map(execution => <div key={execution.id} style={{ margin: '12px 0' }}>
                    <p>{new Date(execution.at).toLocaleString()} · {execution.agent.name}</p>
                    <p>{execution.harness} · {execution.model} · {execution.effort}</p>
                    <Typography.Text code>{execution.agent.commit}</Typography.Text>
                    <p>{execution.runnerId} · {execution.conversationId} · {execution.turnId}</p>
                    <details><summary>Configuration</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(execution.agent, null, 2)}</pre></details>
                </div>)}
            </AsyncList>
        </>}
    </details>;
};
