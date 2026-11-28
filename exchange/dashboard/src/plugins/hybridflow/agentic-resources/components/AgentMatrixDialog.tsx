import React, { useRef, useState } from 'react';
import { Alert, Button, Checkbox, Modal, message } from 'antd';
import { AsyncList } from '@kiao-dashboard-core';
import type { HarnessOptionsEntry, HarnessProfileOffer } from 'kiao-worker';
import type { AgentSelection } from '../../flowNodeSettings';
import type { AgentDto } from '../types';
import styles from './AgentMatrixDialog.module.css';

export interface AgentChoice extends AgentSelection {
    agent: string;
    harness: string;
}

interface Column {
    harness: HarnessOptionsEntry;
    label: string;
    model?: string;
    profile?: HarnessProfileOffer;
}

const columnKey = (column: Column): string =>
    JSON.stringify([column.harness.value, column.profile?.id, column.model]);

const columnsOf = (harnesses: HarnessOptionsEntry[]): Column[] => harnesses.flatMap(harness => {
    if (harness.value === 'pi') {
        return (harness.profiles ?? []).map(profile => ({ harness, profile, label: `Pi / ${profile.name}` }));
    }
    const label = harness.value === 'claude' ? 'Claude Code' : harness.label;
    const active = harness.activeModels;
    if (!active) return [{ harness, label }];
    const defaultModel = harness.defaultModel;
    const models = defaultModel && active.includes(defaultModel)
        ? [defaultModel, ...active.filter(model => model !== defaultModel)]
        : active;
    return models.map(model => ({ harness, model, label: `${label} / ${model}` }));
});

const accepts = (definition: AgentDto | NonNullable<AgentDto['published']>, { harness, profile }: Column): boolean =>
    (definition.harnesses?.length ? definition.harnesses : [definition.harness]).includes(harness.value) &&
    (!profile || (profile.status === 'ready' &&
        (!definition.profileId || definition.profileId === profile.id) &&
        (!definition.model || profile.models.some(model => model.value === definition.model))));

interface Props {
    title: string;
    confirmLabel?: string;
    pendingLabel?: string;
    initial?: AgentSelection;
    allowDraft?: boolean;
    requireCommit?: boolean;
    agents: AgentDto[];
    agentsLoading?: boolean;
    error?: string | null;
    harnesses: HarnessOptionsEntry[];
    harnessesLoading?: boolean;
    onCancel: () => void;
    onConfirm: (choice: AgentChoice, useDraft: boolean) => void | Promise<void>;
}

export const AgentMatrixDialog: React.FC<Props> = ({
    title, confirmLabel, pendingLabel = 'Applying agent selection…', initial, allowDraft, requireCommit, agents, agentsLoading, error,
    harnesses, harnessesLoading, onCancel, onConfirm,
}) => {
    const [selection, setSelection] = useState(initial);
    const [useDraft, setUseDraft] = useState(false);
    const [busy, setBusy] = useState(false);
    const submitting = useRef(false);
    const published = agents.filter(agent => !agent.archived && agent.published && (!requireCommit || agent.published.commit));
    const superseded = new Set(published.flatMap(agent => agent.published?.supersedes ?? []));
    const rows = (useDraft ? agents : published).filter(agent => !agent.archived && !superseded.has(agent.id));
    const columns = columnsOf(harnesses);
    const hasOptions = rows.length > 0 && columns.length > 0;
    const loading = agentsLoading || harnessesLoading;
    const definition = (row: AgentDto) => useDraft ? row : row.published;
    const choiceOf = (row: AgentDto, column: Column): AgentChoice => ({
        agent: row.id, harness: column.harness.value, profileId: column.profile?.id, model: column.model,
    });
    const selectedRow = rows.find(row => row.id === selection?.agent);
    const selectedDefinition = selectedRow && definition(selectedRow);
    const model = selection?.model || selectedDefinition?.model ||
        columns.find(column => column.harness.value === selection?.harness)?.model;
    const selectedColumn = selectedRow && columns.find(column =>
        column.harness.value === selection?.harness && column.profile?.id === selection.profileId &&
        (!column.model || column.model === model),
    );
    const selected = selectedRow && selectedColumn && selectedDefinition &&
        (!useDraft || !selectedRow.draftError) && accepts(selectedDefinition, selectedColumn)
        ? choiceOf(selectedRow, selectedColumn) : undefined;

    const submit = async (choice: AgentChoice) => {
        if (submitting.current) return;
        submitting.current = true;
        setBusy(true);
        try {
            await onConfirm(choice, useDraft);
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : String(cause));
        } finally {
            submitting.current = false;
            setBusy(false);
        }
    };

    return (
        <Modal open title={title} width="min(1120px, calc(100vw - 32px))"
            okText={confirmLabel} confirmLoading={busy}
            okButtonProps={{ disabled: busy || !selected || loading, 'aria-label': confirmLabel, 'aria-busy': busy }}
            cancelButtonProps={{ disabled: busy }} closable={!busy}
            footer={confirmLabel ? undefined : null}
            onCancel={() => { if (!submitting.current) onCancel(); }}
            onOk={() => { if (selected && !loading) void submit(selected); }}>
            {allowDraft && (
                <Checkbox className={styles.draft} checked={useDraft} disabled={busy}
                    onChange={event => setUseDraft(event.target.checked)}>Use local draft</Checkbox>
            )}
            {hasOptions && error && <Alert type="error" showIcon title={error} />}
            {busy && <div className={styles.status}><span role="status">{pendingLabel}</span></div>}
            <AsyncList loading={loading} loadingLabel="Loading agent and model options" error={!hasOptions && error}
                empty={!rows.length
                    ? (useDraft ? 'Create or import an agent in Agents.' : 'Publish an agent in Agents.')
                    : !columns.length && 'Enable a harness with active models or configure a Pi profile on this worker.'}>
                <div className={styles.scroll} tabIndex={0} aria-label="Agent and harness matrix">
                    <table className={styles.matrix}>
                        <thead>
                            <tr>
                                <th scope="col">Agent</th>
                                {columns.map(column => (
                                    <th key={columnKey(column)} scope="col" title={column.profile?.message}>
                                        {column.label}
                                        {column.profile && column.profile.status !== 'ready' &&
                                            <span className={styles.unavailable}>Unavailable</span>}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(row => {
                                const config = definition(row);
                                const name = config?.name || row.name;
                                return (
                                    <tr key={row.id}>
                                        <th scope="row">{name}</th>
                                        {columns.map(column => {
                                            const choice = choiceOf(row, column);
                                            const enabled = config && (!useDraft || !row.draftError) && accepts(config, column);
                                            const pressed = selectedRow === row && selectedColumn === column;
                                            const submittingChoice = busy && pressed && !confirmLabel;
                                            const label = column.model || column.profile
                                                ? 'Select'
                                                : config?.model || column.harness.defaultModel || 'Select';
                                            return (
                                                <td key={columnKey(column)}>
                                                    {enabled ? (
                                                        <Button block disabled={busy} loading={submittingChoice}
                                                            type={pressed ? 'primary' : 'default'}
                                                            aria-label={`${name} · ${column.label}`}
                                                            aria-pressed={pressed}
                                                            aria-busy={submittingChoice}
                                                            onClick={() => {
                                                                setSelection(choice);
                                                                if (!confirmLabel) void submit(choice);
                                                            }}>
                                                            {label}
                                                        </Button>
                                                    ) : <span className={styles.unavailable} aria-label="Unavailable">—</span>}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </AsyncList>
        </Modal>
    );
};
