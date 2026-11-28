import React, { useEffect, useId, useState } from 'react';
import { Select } from 'antd';
import { CommitInput } from '@kiao-dashboard-core';
import type { FlowNode } from '../boardContent';
import type { FlowNodeEdit } from '../boardOps';
import {
    COMMIT_STATUSES, PULL_REQUEST_STATUSES, readCommitId, readCommitStatus, readPullRequestId, readPullRequestStatus,
} from '../flowNodeBitbucket';
import { hasContextReference } from '../nodeContext';
import styles from '../Hybridflow.module.css';

const REFERENCE = 'reference';
const statusOptions = (statuses: readonly string[]) => [
    ...statuses.map(status => ({ value: status, label: status })),
    { value: REFERENCE, label: 'Use a value reference' },
];
const pullRequestOptions = statusOptions(PULL_REQUEST_STATUSES);
const commitOptions = statusOptions(COMMIT_STATUSES);

export const BitbucketStatusEditor: React.FC<{
    node: FlowNode;
    disabled?: boolean;
    onChange: (edit: FlowNodeEdit) => void;
}> = ({ node, disabled, onChange }) => {
    const commit = node.type === 'bitbucket-commit-status';
    const identifier = (commit ? node.commitId : node.pullRequestId) ?? '';
    const status = (commit ? node.commitStatus : node.pullRequestStatus) ?? '';
    const id = useId();
    const [draft, setDraft] = useState(identifier);
    useEffect(() => setDraft(identifier), [identifier]);
    const parsed = (commit ? readCommitId : readPullRequestId)(draft);
    const invalid = !!draft.trim() && !parsed;

    const savedReference = hasContextReference(status);
    const [editingReference, setEditingReference] = useState(false);
    const [target, setTarget] = useState(savedReference ? status : '');
    useEffect(() => setTarget(hasContextReference(status) ? status : ''), [status]);
    const referenceMode = editingReference || savedReference;
    const readTarget = commit ? readCommitStatus : readPullRequestStatus;
    const saveTarget = (value: string) => onChange(commit ? { commitStatus: value } : { pullRequestStatus: value });
    const invalidTarget = !!target.trim() && !readTarget(target);

    return (
        <div className={styles.meta}>
            <label htmlFor={id}>{commit ? 'Commit ID' : 'Pull request ID'}</label>
            <CommitInput
                id={id}
                value={draft}
                placeholder={commit ? 'a1b2c3d or workspace/repository@a1b2c3d' : '42 or workspace/repository#42'}
                title={commit ? 'Use a reference such as {{currentWorkflow.commitId}}.' : 'Use a reference such as {{input.pullRequestId}}.'}
                disabled={disabled}
                status={invalid ? 'error' : undefined}
                aria-invalid={invalid}
                onDraftChange={setDraft}
                onCommit={() => {
                    if (invalid) return;
                    setDraft(parsed);
                    if (parsed !== identifier) onChange(commit ? { commitId: parsed } : { pullRequestId: parsed });
                }}
                blurOnEnter
            />
            {invalid && <span role="alert">{commit
                ? 'Enter a Git hash (7–40 hexadecimal characters), workspace/repository@hash, or a value reference.'
                : 'Enter a positive number, workspace/repository#number, or a value reference.'}</span>}
            <label htmlFor={`${id}-status`}>Target status</label>
            <Select<string>
                id={`${id}-status`}
                size="small"
                value={referenceMode ? REFERENCE : status || undefined}
                placeholder="Choose status"
                options={commit ? commitOptions : pullRequestOptions}
                disabled={disabled}
                allowClear
                onChange={value => {
                    setEditingReference(value === REFERENCE);
                    if (value !== REFERENCE) saveTarget(readTarget(value));
                }}
            />
            {referenceMode && (
                <>
                    <label htmlFor={`${id}-target-reference`}>Target status reference</label>
                    <CommitInput
                        id={`${id}-target-reference`}
                        value={target}
                        placeholder="{{input.targetStatus}}"
                        disabled={disabled}
                        status={invalidTarget ? 'error' : undefined}
                        aria-invalid={invalidTarget}
                        onDraftChange={setTarget}
                        onCommit={() => {
                            if (invalidTarget) return;
                            const value = readTarget(target);
                            if (!value && !savedReference) return;
                            if (value !== status) saveTarget(value);
                            if (value && !hasContextReference(value)) setEditingReference(false);
                        }}
                        blurOnEnter
                    />
                </>
            )}
        </div>
    );
};
