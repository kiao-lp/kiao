import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Input, Modal, Select, type InputRef } from 'antd';
import { DeleteOutlined, EditOutlined, FileTextOutlined } from '@ant-design/icons';
import { useChatOptions } from '@kiao-dashboard-kit/capabilities';
import { Tooltip, useCentralStack } from '@kiao-dashboard-core';
import { useAgents } from '../Agents-ctx';
import { useRunners } from '../Runners-ctx';
import { FlowNodeClass, FlowNodeClassVersion } from '../flowNodeClass';
import { AGENT_KEY, PERMISSION_KEY, RUNNER_KEY, SettingsChanges } from '../flowNodeSettings';
import { TRANSITION_MODE_LABELS, TRANSITION_MODE_ORDER, withoutSuccessor } from '../flowNodeSuccess';
import { chains, settingsHarness, FLOW_NODE_CLASS_TYPE_ORDER, FlowNodeType } from '../flowNodeType';
import { useHybridflow } from '../Hybridflow-ctx';
import { BoardContent } from '../boardContent';
import {
    AgentSelect, PermissionSelect, RunnerSelect, ScheduleInput, SuccessCriteriaEditor, TagsControl,
    TypeSelect,
} from './FlowNodeControls';
import { CLASS_VERSION_TEMPLATE_PANEL_ID, ClassVersionTemplatePanel } from './ClassVersionTemplatePanel';
import styles from '../Hybridflow.module.css';

/**
 * Node class panel.
 * Classes are never played; only drafts are editable, published versions are read-only.
 */
export const FlowNodeClassPanel: React.FC = () => {
    const {
        content, selectedClass, editFlowNodeClass, removeFlowNodeClasses,
        createClassVersion, editClassVersion, publishClassVersion, deleteClassVersion,
        titleCaret, takeTitleCaret,
    } = useHybridflow();
    const titleRef = useRef<InputRef>(null);

    const flowNodeClass = selectedClass?.flowNodeClass ?? null;
    const [viewingId, setViewingId] = useState<string | null>(null);
    const viewing = flowNodeClass ? viewingOf(flowNodeClass.versions, viewingId) : null;
    const [noteOpen, setNoteOpen] = useState(false);

    useEffect(() => {
        if (!flowNodeClass || titleCaret !== flowNodeClass.id) return;
        takeTitleCaret();
        titleRef.current?.focus();
    }, [flowNodeClass, titleCaret, takeTitleCaret]);

    if (!selectedClass || !flowNodeClass || !content) {
        return <div className={styles.panelHint}>Select a node on the board to edit it.</div>;
    }

    return (
        <div className={styles.panel} data-testid="flow-node-class-panel">
            <div className={styles.panelHeader}>
                <span className={styles.panelKind}>Node class</span>
                <Button
                    size="small"
                    type="text"
                    icon={<FileTextOutlined />}
                    aria-label="Edit note"
                    data-testid="edit-flow-node-class-note"
                    onClick={() => setNoteOpen(true)}
                />
                <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label="Delete class"
                    data-testid="delete-flow-node-class"
                    onClick={() => confirmDelete(flowNodeClass, () => removeFlowNodeClasses([flowNodeClass.id]))}
                />
            </div>
            {noteOpen && (
                <ClassNoteEditor
                    note={flowNodeClass.note}
                    onSave={note => editFlowNodeClass(flowNodeClass.id, { note })}
                    onClose={() => setNoteOpen(false)}
                />
            )}
            <Input
                ref={titleRef}
                size="small"
                className={styles.panelTitle}
                value={flowNodeClass.title}
                placeholder="Class title"
                aria-label="Class title"
                data-testid="flow-node-class-title"
                onChange={event => editFlowNodeClass(flowNodeClass.id, { title: event.target.value })}
            />
            <TagsControl
                tags={flowNodeClass.tags}
                onChange={tags => editFlowNodeClass(flowNodeClass.id, { tags })}
            />
            <ClassMetaEditor flowNodeClass={flowNodeClass} version={viewing} />
            {chains(flowNodeClass.type) && content && (
                <ClassSuccessEditor
                    flowNodeClass={flowNodeClass}
                    content={content}
                />
            )}
            <VersionBrowser
                flowNodeClass={flowNodeClass}
                viewing={viewing}
                onSelectVersion={setViewingId}
                onCreateVersion={from => createClassVersion(flowNodeClass.id, from)}
                onEditVersion={(versionId, body, criteria) => editClassVersion(
                    flowNodeClass.id, versionId, { body, criteria })}
                onToggleTemplate={(versionId, template) => editClassVersion(
                    flowNodeClass.id, versionId, { template })}
                onPublishVersion={versionId => publishClassVersion(flowNodeClass.id, versionId)}
                onDeleteVersion={versionId => deleteClassVersion(flowNodeClass.id, versionId)}
            />
        </div>
    );
};

/** Selected version, or the latest when none is selected. */
const viewingOf = (
    versions: FlowNodeClassVersion[], viewingId: string | null,
): FlowNodeClassVersion | null =>
        versions.find(version => version.id === viewingId)
        ?? versions[versions.length - 1]
        ?? null;

const confirmDelete = (flowNodeClass: FlowNodeClass, remove: () => void): void => {
    Modal.confirm({
        title: `Delete the class “${flowNodeClass.title || 'Untitled'}”?`,
        content: 'Its versions go with it, and the nodes made from them are unlinked — keeping what they say.',
        okText: 'Delete class',
        okType: 'danger',
        cancelText: 'Keep it',
        onOk: remove,
    });
};

/** Class note editor. */
const ClassNoteEditor: React.FC<{
    note: string;
    onSave: (note: string) => void;
    onClose: () => void;
}> = ({ note, onSave, onClose }) => {
    const [draft, setDraft] = useState(note);

    return (
        <Modal
            open
            title="Class note"
            okText="Save note"
            cancelText="Cancel"
            onOk={() => { onSave(draft); onClose(); }}
            onCancel={onClose}
        >
            <Input.TextArea
                rows={6}
                value={draft}
                placeholder="What the class is for, when to instantiate it, what its instances assume"
                aria-label="Class note"
                data-testid="flow-node-class-note-body"
                onChange={event => setDraft(event.target.value)}
            />
        </Modal>
    );
};

const confirmDraftDelete = (version: FlowNodeClassVersion, remove: () => void): void => {
    Modal.confirm({
        title: `Delete draft v${version.number}?`,
        content: 'The draft goes; the published versions stay.',
        okText: 'Delete draft',
        okType: 'danger',
        cancelText: 'Keep it',
        onOk: remove,
    });
};

/** Class type and shared settings. */
const ClassMetaEditor: React.FC<{ flowNodeClass: FlowNodeClass; version: FlowNodeClassVersion | null }> = ({
    flowNodeClass, version,
}) => {
    const { editFlowNodeClass, editClassVersion } = useHybridflow();
    const { agents: managed } = useAgents();
    const { runners } = useRunners();
    const { harnesses: engines, optionsFor } = useChatOptions();
    const own = optionsFor(settingsHarness({ agent: version?.agent }, managed) || engines[0]?.value || '');
    const edit = (changes: SettingsChanges) => {
        if (changes[PERMISSION_KEY] !== undefined) {
            editFlowNodeClass(flowNodeClass.id, { permission: changes[PERMISSION_KEY] ?? '' });
        }
        if (changes[RUNNER_KEY] !== undefined) {
            editFlowNodeClass(flowNodeClass.id, { runner: changes[RUNNER_KEY] ?? '' });
        }
    };
    // Agent only; class permission is edited by its own select.
    const editAgent = (changes: SettingsChanges) => {
        if (version && AGENT_KEY in changes) {
            editClassVersion(flowNodeClass.id, version.id, { agent: changes[AGENT_KEY] ?? '' });
        }
    };

    return (
        <div className={styles.meta} data-testid="flow-node-class-meta">
            <div className={styles.metaRow}>
                <TypeSelect
                    type={flowNodeClass.type}
                    choices={FLOW_NODE_CLASS_TYPE_ORDER}
                    onChange={(next: FlowNodeType) => editFlowNodeClass(flowNodeClass.id, { type: next })}
                />
                <Tooltip title="Offers this class in the Instantiate menu; successors can instantiate it regardless.">
                    <Checkbox
                        className={styles.metaCheck}
                        checked={flowNodeClass.instantiable}
                        onChange={event => editFlowNodeClass(flowNodeClass.id, {
                            instantiable: event.target.checked,
                        })}
                        data-testid="flow-node-class-instantiable"
                    >
                        Instantiable
                    </Checkbox>
                </Tooltip>
                {flowNodeClass.type === 'scheduler' && (
                    <ScheduleInput
                        key={flowNodeClass.id}
                        at={flowNodeClass.at}
                        duration={flowNodeClass.duration}
                        onChange={(at, duration) => editFlowNodeClass(flowNodeClass.id, { at, duration })}
                    />
                )}
            </div>
            {flowNodeClass.type === 'ai' && (
                <div className={styles.metaRow}>
                    {version && (
                        <AgentSelect
                            settings={{ agent: version.agent || undefined }}
                            agents={managed}
                            onChange={editAgent}
                            disabled={version.status !== 'draft'}
                            allowClear
                            help="Default agent for instances created from this version."
                            testId="flow-node-class-agent"
                        />
                    )}
                    <PermissionSelect
                        settings={{ permission: flowNodeClass.permission || undefined }}
                        options={own.permissionModes}
                        onChange={edit}
                    />
                    <RunnerSelect
                        settings={{ runner: flowNodeClass.runner || undefined }}
                        runners={runners}
                        onChange={edit}
                    />
                </div>
            )}
        </div>
    );
};

/** Successor class, transition mode, and compact flag. */
const ClassSuccessEditor: React.FC<{ flowNodeClass: FlowNodeClass; content: BoardContent }> = ({
    flowNodeClass, content,
}) => {
    const { editFlowNodeClass } = useHybridflow();
    const success = flowNodeClass.onSuccess;
    const options = useMemo(() => [
        { value: '!none', label: 'Nothing next' },
        ...content.flowNodeClasses
            .filter(one => one.id !== flowNodeClass.id)
            .map(one => ({ value: one.id, label: one.title || 'Untitled' })),
    ], [content, flowNodeClass.id]);
    const modeOptions = useMemo(
        () => TRANSITION_MODE_ORDER.map(value => ({ value, label: TRANSITION_MODE_LABELS[value] })),
        [],
    );

    return (
        <div className={styles.meta} data-testid="flow-node-class-success">
            <div className={styles.metaRow}>
                {flowNodeClass.type === 'ai' && (
                    <Tooltip title="Shorten an instance's chat after a good end">
                        <Checkbox
                            className={styles.metaCheck}
                            checked={success.compact}
                            onChange={event => editFlowNodeClass(flowNodeClass.id, {
                                onSuccess: { ...success, compact: event.target.checked },
                            })}
                            data-testid="flow-node-class-compact"
                        >
                            Compact
                        </Checkbox>
                    </Tooltip>
                )}
                {flowNodeClass.type === 'ai' && (
                    <Tooltip title="Who keeps an instance's chat">
                        <Select
                            size="small"
                            className={styles.metaSelect}
                            value={success.mode}
                            options={modeOptions}
                            onChange={mode => editFlowNodeClass(flowNodeClass.id, {
                                onSuccess: { ...success, mode },
                            })}
                            aria-label="Transition mode"
                            data-testid="flow-node-class-transition-mode"
                        />
                    </Tooltip>
                )}
                <Select
                    size="small"
                    className={`${styles.metaSelect} ${styles.metaNext}`}
                    value={success.flowNode || '!none'}
                    options={options}
                    onChange={value => editFlowNodeClass(flowNodeClass.id, {
                        onSuccess: value === '!none'
                            ? withoutSuccessor(success)
                            : { ...success, flowNode: value },
                    })}
                    aria-label="On success"
                    data-testid="flow-node-class-next"
                />
            </div>
        </div>
    );
};

/** Version list and editor. Published versions are read-only; new versions copy the selected one. */
const VersionBrowser: React.FC<{
    flowNodeClass: FlowNodeClass;
    viewing: FlowNodeClassVersion | null;
    onSelectVersion: (versionId: string) => void;
    onCreateVersion: (from?: FlowNodeClassVersion) => void;
    onEditVersion: (versionId: string, body: string, criteria: FlowNodeClassVersion['criteria']) => void;
    onToggleTemplate: (versionId: string, template: boolean) => void;
    onPublishVersion: (versionId: string) => void;
    onDeleteVersion: (versionId: string) => void;
}> = ({
    flowNodeClass, viewing, onSelectVersion,
    onCreateVersion, onEditVersion, onToggleTemplate, onPublishVersion, onDeleteVersion,
}) => {
    const versions = flowNodeClass.versions;

    const options = versions.map(version => ({
        value: version.id,
        label: `v${version.number} · ${version.status}`,
    }));

    return (
        <div className={`${styles.meta} ${styles.panelVersions}`} data-testid="flow-node-class-versions">
            <div className={`${styles.metaRow} ${styles.metaRowWrap}`}>
                <Select
                    size="small"
                    className={styles.metaSelect}
                    value={viewing?.id}
                    options={options}
                    onChange={onSelectVersion}
                    aria-label="Version"
                    data-testid="flow-node-class-version-select"
                    placeholder="No versions yet"
                />
                <Button
                    size="small"
                    data-testid="flow-node-class-new-version"
                    onClick={() => onCreateVersion(viewing ?? undefined)}
                >
                    New version
                </Button>
                {viewing && viewing.status === 'draft' && (
                    <>
                        <Button
                            size="small"
                            type="primary"
                            data-testid="flow-node-class-publish"
                            onClick={() => onPublishVersion(viewing.id)}
                        >
                            Publish
                        </Button>
                        <Button
                            size="small"
                            danger
                            data-testid="flow-node-class-delete-draft"
                            onClick={() => confirmDraftDelete(
                                viewing, () => onDeleteVersion(viewing.id))}
                        >
                            Delete draft
                        </Button>
                    </>
                )}
            </div>
            {viewing && (
                <VersionEditor
                    key={viewing.id}
                    classId={flowNodeClass.id}
                    classTitle={flowNodeClass.title}
                    version={viewing}
                    onEdit={(body, criteria) => onEditVersion(viewing.id, body, criteria)}
                    onToggleTemplate={template => onToggleTemplate(viewing.id, template)}
                />
            )}
        </div>
    );
};

/**
 * Version body and criteria editor.
 * Read-only when published; template mode fills the body at instantiation.
 */
const VersionEditor: React.FC<{
    classId: string;
    classTitle: string;
    version: FlowNodeClassVersion;
    onEdit: (body: string, criteria: FlowNodeClassVersion['criteria']) => void;
    onToggleTemplate: (template: boolean) => void;
}> = ({ classId, classTitle, version, onEdit, onToggleTemplate }) => {
    const [body, setBody] = useState(version.body);
    const draft = version.status === 'draft';
    const { push } = useCentralStack();

    // Sync external template edits; local typing commits on blur.
    useEffect(() => { setBody(version.body); }, [version.body]);

    const editTemplate = () => {
        push({
            id: CLASS_VERSION_TEMPLATE_PANEL_ID,
            title: `Edit the template of “${classTitle || 'Untitled'}” v${version.number}`,
            closeLabel: 'Close',
            content: (
                <ClassVersionTemplatePanel
                    key={version.id}
                    classId={classId}
                    versionId={version.id}
                />
            ),
        });
    };

    return (
        <>
            <div className={styles.metaRow}>
                <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    aria-label="Edit template"
                    data-testid="flow-node-class-version-edit-template"
                    disabled={!draft || !version.template}
                    onClick={editTemplate}
                />
                <Tooltip title="Fills a template when creating an instance, instead of copying the description.">
                    <Checkbox
                        className={styles.metaCheck}
                        checked={version.template}
                        disabled={!draft}
                        onChange={event => onToggleTemplate(event.target.checked)}
                        data-testid="flow-node-class-version-template"
                    >
                        Template
                    </Checkbox>
                </Tooltip>
            </div>
            <Input.TextArea
                size="small"
                className={styles.panelVersionBody}
                value={body}
                rows={6}
                placeholder="Version description"
                aria-label="Version description"
                data-testid="flow-node-class-version-body"
                disabled={!draft}
                onChange={event => setBody(event.target.value)}
                onBlur={() => { if (draft && body !== version.body) onEdit(body, version.criteria); }}
            />
            {draft ? (
                <SuccessCriteriaEditor
                    criteria={version.criteria}
                    onChange={criteria => onEdit(body, criteria)}
                />
            ) : (
                <ul className={styles.metaCriteria} data-testid="flow-node-class-version-criteria">
                    {version.criteria.map(criterion => (
                        <li key={criterion.id}>{criterion.text}</li>
                    ))}
                </ul>
            )}
        </>
    );
};
