import React, { useEffect, useId, useState } from 'react';
import { Button, Select } from 'antd';
import { CommitInput } from '@kiao-dashboard-core';
import { isRunnable, type BoardContent, type FlowNode } from '../boardContent';
import type { FlowNodeEdit } from '../boardOps';
import { canConnect } from '../flowConnections';
import { isPassCount, LIMITER_BRANCHES, MAX_PASSES, readLimiter } from '../flowNodeLimiter';
import styles from '../Hybridflow.module.css';

interface Props {
    node: FlowNode;
    content: BoardContent;
    readOnly: boolean;
    onChange: (edit: FlowNodeEdit) => void;
}

export const LimiterEditor: React.FC<Props> = ({ node, content, readOnly, onChange }) => {
    const id = useId();
    const { maxPasses, remainingPasses } = readLimiter(node);
    const [draft, setDraft] = useState(String(maxPasses));
    useEffect(() => setDraft(String(maxPasses)), [maxPasses]);
    const maximum = Number(draft);
    const invalid = draft === '' || !isPassCount(maximum);

    const branches = node.onSuccess.flowNodes;
    const options = content.flowNodes
        .filter(target => !target.archived && canConnect(content.flowNodes, node.id, target.id))
        .map(target => ({ value: target.id, label: target.title || 'Untitled' }));

    const setBranch = (index: number, target: string | undefined) => {
        const next = [...branches];
        const other = 1 - index;
        if (target === undefined) {
            next.splice(index, 1);
        } else {
            if (target === next[other]) next[other] = next[index];
            next[index] = target;
        }
        onChange({ onSuccess: { ...node.onSuccess, flowNodes: next } });
    };

    return (
        <div className={styles.meta}>
            <label htmlFor={id}>Maximum passes</label>
            <div className={styles.metaRow}>
                <CommitInput
                    id={id}
                    type="number"
                    min={0}
                    max={MAX_PASSES}
                    step={1}
                    value={draft}
                    disabled={readOnly}
                    status={invalid ? 'error' : undefined}
                    aria-invalid={invalid}
                    onDraftChange={setDraft}
                    onCommit={() => {
                        if (invalid) return;
                        setDraft(String(maximum));
                        if (maximum !== maxPasses) onChange({ maxPasses: maximum });
                    }}
                    blurOnEnter
                />
                <Button
                    size="small"
                    disabled={readOnly || remainingPasses === maxPasses}
                    onClick={() => onChange({ resetPasses: true })}
                >
                    Reset counter
                </Button>
            </div>
            {invalid && <span role="alert">Enter a whole number from 0 to {MAX_PASSES}.</span>}
            {LIMITER_BRANCHES.map((label, index) => {
                const branchId = `${id}-${index}`;
                return (
                    <React.Fragment key={label}>
                        <label htmlFor={branchId}>{label}</label>
                        <Select<string>
                            id={branchId}
                            aria-label={label}
                            size="small"
                            value={branches[index]}
                            labelRender={({ label }) => label ?? 'Unavailable successor'}
                            options={options.filter(option => branches[index] || option.value !== branches[1 - index])}
                            placeholder="Choose successor"
                            disabled={readOnly || (index === 1 && !branches[0])}
                            allowClear
                            onChange={target => setBranch(index, target)}
                        />
                    </React.Fragment>
                );
            })}
            {!isRunnable(node, { flowNodes: content.flowNodes }) && <span role="alert">Link a successor for each branch.</span>}
        </div>
    );
};
