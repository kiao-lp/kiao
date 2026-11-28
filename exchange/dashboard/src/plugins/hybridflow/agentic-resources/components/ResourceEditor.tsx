import React, { useRef, useState } from 'react';
import { Alert, Button } from 'antd';
import { InProgressFeedback } from '@kiao-dashboard-core';
import type { ReleaseBump } from '../release';
import type { ResourceKind } from '../types';
import { PublishButtons } from './PublishButtons';
import styles from './ResourceEditor.module.css';

export const resourceLabels = { agent: 'agent', skill: 'skill', mcp: 'MCP' };

const operationResults = { publish: 'published', pull: 'pulled', push: 'pushed', install: 'installed', dependencies: 'updated' };
type Operation = keyof typeof operationResults;

export function useResourceOperations(flush: () => Promise<boolean>) {
    const [active, setActive] = useState<{ operation: Operation; bump?: ReleaseBump } | null>(null);
    const [error, setError] = useState<{ operation: Operation; detail: string } | null>(null);
    const running = useRef(false);

    const run = async (operation: Operation, execute: () => Promise<unknown>, bump?: ReleaseBump) => {
        if (running.current) return;
        running.current = true;
        setActive({ operation, bump });
        setError(null);
        try {
            if (await flush()) await execute();
        } catch (cause) {
            setError({ operation, detail: cause instanceof Error ? cause.message : String(cause) });
        } finally {
            running.current = false;
            setActive(null);
        }
    };

    return { active, busy: active !== null, error, dismissError: () => setError(null), run, flush };
}

interface EditorProps {
    kind: ResourceKind;
    repository?: string;
    version?: string;
    versionPicker: React.ReactNode;
    operations: ReturnType<typeof useResourceOperations>;
    onPublish?: (bump: ReleaseBump) => Promise<unknown>;
    onPull?: () => Promise<unknown>;
    checkingRemote?: boolean;
    extraControls?: React.ReactNode;
    children: React.ReactNode;
}

export const ResourceEditor: React.FC<EditorProps> = ({
    kind, repository, version, versionPicker, operations, onPublish, onPull, checkingRemote, extraControls, children,
}) => {
    const { active, busy, error, dismissError, run, flush } = operations;
    return <div className={styles.editor} data-testid={`${kind}-editor`} onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            event.preventDefault();
            if (!busy) void flush();
        }
    }}>
        <div className={styles.row}>
            {versionPicker}
            <PublishButtons version={version} disabled={busy || !onPublish} publishing={active?.bump}
                onPublish={bump => { if (onPublish) void run('publish', () => onPublish(bump), bump); }} />
            <Button loading={checkingRemote || active?.operation === 'pull'} disabled={busy || checkingRemote || !onPull}
                aria-label="Pull" aria-busy={checkingRemote || active?.operation === 'pull'}
                onClick={() => { if (onPull) void run('pull', onPull); }}>Pull</Button>
            {extraControls}
        </div>
        {active?.operation === 'dependencies' && <InProgressFeedback label="Updating agent dependencies…" />}
        {error && <Alert type="error" showIcon title={error.operation === 'install' ? 'Dependencies could not be installed'
            : `The ${resourceLabels[kind]} could not be ${operationResults[error.operation]}`}
            description={error.detail} closable={{ onClose: dismissError }} />}
        {repository && <p className={styles.meta}>{repository}</p>}
        {children}
    </div>;
};
