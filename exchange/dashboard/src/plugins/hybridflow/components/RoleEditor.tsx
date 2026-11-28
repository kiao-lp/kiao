import React, { useId, useState } from 'react';
import { Input, Radio } from 'antd';
import { CommitInput } from '@kiao-dashboard-core';
import type { FlowNode } from '../boardContent';
import type { FlowNodeEdit } from '../boardOps';
import { isRoleId, readPeople } from '../flowNodeRole';
import styles from '../Hybridflow.module.css';

interface Props {
    node: FlowNode;
    nodes: readonly FlowNode[];
    onChange: (edit: FlowNodeEdit) => void;
}

export const RoleEditor: React.FC<Props> = ({ node, nodes, onChange }) => {
    const id = useId();
    const savedId = node.roleId ?? '';
    const savedPeople = node.people?.join('\n') ?? '';
    const savedDescription = node.description ?? '';
    const [roleIdDraft, setRoleIdDraft] = useState<string | null>(null);
    const [peopleDraft, setPeopleDraft] = useState<string | null>(null);
    const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);

    const key = (roleIdDraft ?? savedId).trim();
    const taken = key !== '' && nodes.some(other =>
        other.id !== node.id && other.type === 'role' && !other.archived && other.roleId === key);
    const error = !isRoleId(key) ? 'Use letters A–Z, digits, underscores or hyphens.'
        : taken ? 'This role ID is already used on the board.' : '';

    return (
        <div className={styles.meta}>
            <span id={`${id}-kind`}>Role type</span>
            <div role="radiogroup" aria-labelledby={`${id}-kind`}>
                <Radio.Group value={node.roleKind ?? 'human'} onChange={event => onChange({ roleKind: event.target.value })}>
                    <Radio value="human">Human</Radio>
                    <Radio value="agent">Agent</Radio>
                </Radio.Group>
            </div>
            <label htmlFor={id}>Role ID</label>
            <CommitInput
                id={id}
                value={roleIdDraft ?? savedId}
                aria-invalid={!!error}
                aria-describedby={`${id}-hint`}
                status={error ? 'error' : undefined}
                onDraftChange={setRoleIdDraft}
                onCommit={() => {
                    if (roleIdDraft === null || error) return;
                    setRoleIdDraft(null);
                    if (key !== savedId) onChange({ roleId: key });
                }}
                blurOnEnter
            />
            {error
                ? <span id={`${id}-hint`} role="alert">{error}</span>
                : <span id={`${id}-hint`}>Insert people with <code>{`{{role.${key || 'ID'}}}`}</code></span>}
            <label htmlFor={`${id}-description`}>Description</label>
            <Input.TextArea
                id={`${id}-description`}
                value={descriptionDraft ?? savedDescription}
                rows={2}
                onChange={event => setDescriptionDraft(event.target.value)}
                onBlur={() => {
                    if (descriptionDraft === null) return;
                    const description = descriptionDraft.trim();
                    setDescriptionDraft(null);
                    if (description !== savedDescription) onChange({ description });
                }}
            />
            <label htmlFor={`${id}-people`}>People</label>
            <Input.TextArea
                id={`${id}-people`}
                value={peopleDraft ?? savedPeople}
                rows={5}
                placeholder="One person per line"
                onChange={event => setPeopleDraft(event.target.value)}
                onBlur={() => {
                    if (peopleDraft === null) return;
                    const lines = readPeople(peopleDraft.split(/\r?\n/));
                    setPeopleDraft(null);
                    if (lines.join('\n') !== savedPeople) onChange({ people: lines });
                }}
            />
        </div>
    );
};
