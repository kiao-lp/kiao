import React from 'react';
import { Alert, Button, Input, Select } from 'antd';
import { InProgressFeedback } from '@kiao-dashboard-core';
import type { useResourceSource } from '../useResourceSource';
import styles from './ResourceEditor.module.css';

interface Props {
    files: string[];
    path?: string;
    select: (path: string) => void;
    source: ReturnType<typeof useResourceSource>;
    busy: boolean;
    readOnly?: boolean;
}

export const ResourceSourceFields: React.FC<Props> = ({ files, path, select, source, busy, readOnly }) => {
    if (files.length === 0) return <p className={styles.hint}>No source files in this repository.</p>;
    const loading = !!path && !source.file && !source.error;
    return <>
        <Select aria-label="Resource file" value={path} disabled={busy} options={files.map(file => ({ value: file, label: file }))}
            onChange={next => { void source.switchFile(() => select(next)); }} />
        {source.switching
            ? <InProgressFeedback label="Saving before switching files…" />
            : loading && <InProgressFeedback label="Loading resource file…" />}
        {readOnly && <p>Identity metadata is managed in the agent editor.</p>}
        {source.error && <Alert type="error" showIcon title={source.error} action={
            <Button size="small" disabled={busy} onClick={() => void source.reload()}>{source.file ? 'Reload file' : 'Try again'}</Button>
        } />}
        <Input.TextArea aria-label="Resource source" disabled={busy || !source.file || readOnly}
            value={source.file?.content ?? ''} onChange={event => source.change(event.target.value)}
            autoSize={{ minRows: 12, maxRows: 35 }} className={styles.source} />
    </>;
};
