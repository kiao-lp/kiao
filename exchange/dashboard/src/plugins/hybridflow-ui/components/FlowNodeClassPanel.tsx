import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Input, Modal, Select, type InputRef } from 'antd';
import { DeleteOutlined, EditOutlined, FileTextOutlined } from '@ant-design/icons';
import { useChatOptions } from '@cms-kit/capabilities';
import { Tooltip, useCentralStack } from '@cms-core';
import { useAgents } from '../Agents-ctx';
import { useRunners } from '../Runners-ctx';
import { FlowNodeClass, FlowNodeClassVersion } from '../flowNodeClass';
import { AGENT_KEY, PERMISSION_KEY, RUNNER_KEY, SettingsChanges } from '../flowNodeSettings';
import { TRANSITION_MODE_LABELS, TRANSITION_MODE_ORDER, withoutSuccessor } from '../flowNodeSuccess';
import { chains, settingsPlatform, FLOW_NODE_CLASS_TYPE_ORDER, FlowNodeType } from '../flowNodeType';
import { useHybridflow } from '../Hybridflow-ctx';
import { BoardContent } from '../boardContent';
import {
    AgentSelect, PermissionSelect, RunnerSelect, ScheduleInput, SuccessCriteriaEditor, TagsControl,
    TypeSelect,
} from './FlowNodeControls';
import { CLASS_VERSION_TEMPLATE_PANEL_ID, ClassVersionTemplatePanel } from './ClassVersionTemplatePanel';
import styles from '../Hybridflow.module.css';

/**
 * The open node class: its title, its kind, the AI answers its instances share, what comes
 * after it — and its versions, picked in the navigation select and read below it.
 *
 * A class is never played, so the panel asks nothing about playing it: no status, no chat, no
 * effort, no folder. What it asks is what every instance shares — the title, the kind, the
 * tags, the note beside the card, the permission mode and the runner on an AI class, the
 * preset datetime on a Scheduler — the default agent of the version being read, and then the
 * words, version by version.
 *
 * A version is read whole: the description in a box, what done means under it. Only a draft
 * may be changed — a published version is shown read-only, being what stays said — and a draft
 * is published from here. A new version starts from the one being read, which is what "successive
 * versions" are: the next words, edited from the last ones.
 */
export const FlowNodeClassPanel: React.FC = () => {
    const {
        content, selectedClass, editFlowNodeClass, removeFlowNodeClasses,
        createClassVersion, editClassVersion, publishClassVersion, deleteClassVersion,
        titleCaret, takeTitleCaret,
    } = useHybridflow();
    const titleRef = useRef<InputRef>(null);

    const flowNodeClass = selectedClass?.flowNodeClass ?? null;
    // The version being read: picked in the navigation select below, and what the default
    // agent above it belongs to. An id of another class reads as nothing picked — ids are
    // uuids, so that is what switching classes does — and the succession's end is read then.
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
                <Tooltip title="Edit the class note">
                    <Button
                        size="small"
                        type="text"
                        icon={<FileTextOutlined />}
                        aria-label="Edit note"
                        data-testid="edit-flow-node-class-note"
                        onClick={() => setNoteOpen(true)}
                    />
                </Tooltip>
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

/** The version being read: the one picked, or the succession's end where none was. */
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

/**
 * The class's own words beside the reusable card: what the class is for, when to instantiate
 * it, what its instances assume. Written here, in a dialog, and kept on the class — asked of
 * every kind of class and copied to no instance.
 */
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

/**
 * What kind of class the open one is, and the answers its instances share: on an AI class, the
 * default agent of the version being read, the permission mode and the runner on one line —
 * the preset datetime on a Scheduler. No effort, no folder — those are the instance's, and an
 * instantiated node arrives naming neither of them.
 *
 * The agent sits with the version rather than the class because successive versions may
 * default to different agents, the way they say different words — so the box reads the
 * version being read, and is dark where that one is published. The permission modes are that
 * agent's platform's vocabulary; where the class holds no version yet, the deployment's first
 * engine's — a class names no agent until its first version does.
 */
const ClassMetaEditor: React.FC<{ flowNodeClass: FlowNodeClass; version: FlowNodeClassVersion | null }> = ({
    flowNodeClass, version,
}) => {
    const { editFlowNodeClass, editClassVersion } = useHybridflow();
    const { agents: managed } = useAgents();
    const { runners } = useRunners();
    const { agents: engines, optionsFor } = useChatOptions();
    const own = optionsFor(settingsPlatform({ agent: version?.agent }, managed) || engines[0]?.value || '');
    const edit = (changes: SettingsChanges) => {
        if (changes[PERMISSION_KEY] !== undefined) {
            editFlowNodeClass(flowNodeClass.id, { permission: changes[PERMISSION_KEY] ?? '' });
        }
        if (changes[RUNNER_KEY] !== undefined) {
            editFlowNodeClass(flowNodeClass.id, { runner: changes[RUNNER_KEY] ?? '' });
        }
    };
    // The version's agent alone: what the select clears beside it — the effort and the
    // permission mode where the platform changed — is a card's answers, and the class's
    // permission is the class's own, left where it was for its own select to say.
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
                <Tooltip title="Offer the class in the canvas menu's Instantiate list — unticked, it is still instantiated as the successor of a class that is">
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
                            help={`The default agent of v${version.number}: which managed agent an instance made from this version is played by at first, picked by name.`}
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

/**
 * What the open class hands on to when its instances are over and went well: the class after
 * it — a class, never a version or a simple flow node — and, on an AI class, the transition
 * mode and the Compact box. A class is never played, so the mode claims no warning: there is
 * no Play button missing anywhere for it to explain.
 */
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
                <Tooltip title="The class after this one, from this board">
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
                </Tooltip>
            </div>
        </div>
    );
};

/**
 * The versions: a navigation select to see them — each under its number, saying whether it is
 * a draft or published — and the one being read below it. The description is a box committed
 * on blur, and what done means sits under it; both read-only on a published version. A draft
 * is published from here, or deleted where somebody changed their mind about it, and a new
 * version starts from the one being read.
 */
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
 * One version's words: the description in a box, committed on blur, and what done means under
 * it. Read-only where the version is published — what it says is what stays said — and the
 * criteria editor commits each change as it is made, like the node's own.
 *
 * Above the box, whether the words are a template: a body written as a complete `.temp.md`
 * template — `## Root` and the optional `##` blocks — is filled in when the class is
 * instantiated, one panel per version in the central area, rather than copied onto the flow
 * node. A draft's to tick, like the words: a published version shows the box as it was left.
 *
 * Left of the checkbox, the button that edits the template itself: the same template editor a
 * `.temp.md` file is modified with, over the version's body, in the document panel. On a draft
 * in template mode and nowhere else — a published version is read-only, and a plain body is
 * edited in the box below rather than converted behind the user's back.
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

    // The template editor in the document panel writes the same body: a body that moved under
    // this box is re-read, so the next blur does not write the older text back over it. Typing
    // here moves nothing until blur, so nothing typed is ever thrown away.
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
                <Tooltip title="Edit the template in the document panel">
                    <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        aria-label="Edit template"
                        data-testid="flow-node-class-version-edit-template"
                        disabled={!draft || !version.template}
                        onClick={editTemplate}
                    />
                </Tooltip>
                <Tooltip title="The description is a .temp.md template (# Name, ## Root, optional ## blocks) filled in when the class is instantiated — one panel per version — rather than copied">
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
