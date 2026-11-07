import React, { useCallback, useEffect, useState } from 'react';
import { Select } from 'antd';
import { Tooltip } from '@cms-core';
import { useHybridflowClient } from '../service/HybridflowClient-ctx';
import type { SchemaValueDto } from '../service/types';
import styles from '../Hybridflow.module.css';

interface FlowNodeOutputSelectProps {
    outputType: string;
    onChange: (next: string) => void;
    disabled?: boolean;
}

export const FlowNodeOutputSelect: React.FC<FlowNodeOutputSelectProps> = ({ outputType, onChange, disabled }) => {
    const client = useHybridflowClient();
    const [schemas, setSchemas] = useState<SchemaValueDto[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const reload = useCallback(async () => {
        if (!client) return;
        setLoading(true);
        try {
            setSchemas(await client.schemaValues());
            setError('');
        } catch {
            setError('Could not load output types');
        } finally {
            setLoading(false);
        }
    }, [client]);
    useEffect(() => { void reload(); }, [reload]);

    const options = [
        { value: '', label: 'No output type' },
        ...schemas.map(schema => ({ value: schema.id, label: `${schema.boardName} / ${schema.title || 'Untitled value'}` })),
    ];
    if (outputType && !options.some(option => option.value === outputType)) {
        options.push({ value: outputType, label: 'Unavailable output schema' });
    }
    return (
        <>
            <Tooltip title="Choose a JSON Schema value from any board. Export JSON in a final output block. The next task reads it with {{input.message}}.">
                <Select
                    size="small"
                    className={styles.metaSelect}
                    aria-label="Output type"
                    data-testid="flow-node-output-type"
                    value={outputType}
                    disabled={disabled}
                    options={options}
                    onChange={onChange}
                    onOpenChange={open => { if (open) void reload(); }}
                    loading={loading}
                    status={error ? 'error' : undefined}
                    popupMatchSelectWidth={false}
                    showSearch={{ optionFilterProp: 'label' }}
                />
            </Tooltip>
            {error && <div role="alert">{error}</div>}
        </>
    );
};

export const FlowNodeOutputValue: React.FC<{ output?: unknown }> = ({ output }) => (
    output !== undefined ? (
        <details data-testid="flow-node-output">
            <summary>Output</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(output, null, 2)}</pre>
        </details>
    ) : null
);

export const FlowNodeOutput: React.FC<FlowNodeOutputSelectProps & { output?: unknown }> = ({ output, ...selectProps }) => (
    <div>
        <FlowNodeOutputSelect {...selectProps} />
        <FlowNodeOutputValue output={output} />
    </div>
);
