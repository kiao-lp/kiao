import React from 'react';
import { Input } from 'antd';
import { ConfiguredMarkdown, markdownLinkDrop } from '@cms-core';
import { MarkdownEditorBody, MarkdownEditorToolbar, useMarkdownEditorControls } from '@cms-kit/markdown-editor';
import { useChatOptions } from '@cms-kit/capabilities';
import { useHybridflow } from '../Hybridflow-ctx';
import { boardFolder } from '../boardRoute';
import { useFlowNodeEditing } from '../FlowNodeEditing-ctx';
import { useAgents } from '../Agents-ctx';
import { useRunners } from '../Runners-ctx';
import { useOpenFlowNodeChat } from '../useOpenFlowNodeChat';
import { useChatAvailable } from '../useChatAvailable';
import { SettingsChanges, effortsForAgent, profileForAgent, FlowNodeSettings } from '../flowNodeSettings';
import { FlowNodeStatus } from '../flowNodeStatus';
import { FlowNodeSuccess } from '../flowNodeSuccess';
import { chains, hasFolder, isForAgent, isTask, settingsPlatform, FlowNodeType } from '../flowNodeType';
import { SuccessCriterion, TaskComplexity, BoardContent } from '../boardContent';
import {
    AgentSelect, ChatLink, CompactCheck, ComplexitySelect, EffortSelect, FolderInput, NextFlowNodeSelect,
    PermissionSelect, RunnerSelect, ScheduleInput, StatusSelect, SuccessCriteriaEditor, TagsControl,
    TransitionModeSelect, TypeSelect, ValueTypeSelect,
} from './FlowNodeControls';
import { resolvedValueSchema } from '../valueType';
import type { JsonSchema } from '@cms-kit/code-editor';
import { FlowNodeTemplateSelect } from './FlowNodeTemplateSelect';
import { BOARD_TAB_ID } from '../constants';
import { FlowNodeCosts } from './FlowNodeCosts';
import { FlowNodeValueEditor } from './FlowNodeValueEditor';
import { FlowNodeOutput } from './FlowNodeOutput';
import styles from '../Hybridflow.module.css';

/** The open flow node over the board: the markdown editor every `. md` file gets — source, live. */
export const FlowNodeEditorPanel: React.FC = () => {
    const { content, handle, selectedFlowNode } = useHybridflow();
    const {
        readOnly, title, body, note, valueText, valueError, editTitle, editBody, editNote, editValueText, editValueType, editOutputType,
        editTags, editCriteria, editComplexity,
        editMeta, editType, editSchedule, editSuccess, editStatus, unlinkChat,
    } = useFlowNodeEditing();
    const agentAvailable = useChatAvailable();

    const flowNode = selectedFlowNode?.flowNode ?? null;
    const openChat = useOpenFlowNodeChat(flowNode?.chat ?? '');

    if (!flowNode || !content) return null;

    return (
        <FlowNodeEditor
            readOnly={readOnly}
            title={title}
            body={body}
            note={note}
            valueText={valueText}
            valueError={valueError}
            valueType={flowNode.valueType}
            onNoteChange={editNote}
            onValueTextChange={editValueText}
            onValueTypeChange={editValueType}
            outputType={flowNode.outputType ?? ''}
            output={flowNode.output}
            onOutputTypeChange={editOutputType}
            tags={flowNode.tags}
            type={flowNode.type}
            settings={flowNode.settings}
            at={flowNode.at}
            duration={flowNode.duration}
            success={flowNode.onSuccess}
            content={content}
            boardHandle={handle}
            flowNodeId={flowNode.id}
            status={flowNode.status}
            chat={flowNode.chat}
            criteria={flowNode.criteria}
            complexity={flowNode.complexity}
            showClaude={agentAvailable}
            onTitleChange={editTitle}
            onBodyChange={editBody}
            onTagsChange={editTags}
            onCriteriaChange={editCriteria}
            onComplexityChange={editComplexity}
            onMetaChange={editMeta}
            onTypeChange={editType}
            onScheduleChange={editSchedule}
            onSuccessChange={editSuccess}
            onStatusChange={editStatus}
            onOpenChat={openChat}
            onUnlinkChat={unlinkChat}
        />
    );
};

interface FlowNodeEditorProps {
    readOnly: boolean;

    title: string;
    body: string;
    note: string;
    valueText: string;
    valueError: string;
    valueType: string;
    outputType: string;
    output?: unknown;
    onOutputTypeChange: (next: string) => void;
    onNoteChange: (next: string) => void;
    onValueTextChange: (next: string) => void;
    onValueTypeChange: (next: string) => void;
    tags: string[];

    type: FlowNodeType;
    settings: FlowNodeSettings;

    at: string;
    duration?: string;

    success: FlowNodeSuccess;

    content: BoardContent;

    boardHandle: string | null;

    flowNodeId: string;

    status: FlowNodeStatus;
    chat: string;
    /** What done means, and how heavy it looks — the task's own two, drawn for a task only. */
    criteria: SuccessCriterion[];
    complexity: TaskComplexity;

    showClaude: boolean;
    onTitleChange: (next: string) => void;
    onBodyChange: (next: string) => void;
    onTagsChange: (next: string[]) => void;
    onCriteriaChange: (next: SuccessCriterion[]) => void;
    onComplexityChange: (next: TaskComplexity) => void;
    onMetaChange: (changes: SettingsChanges) => void;

    onTypeChange: (next: FlowNodeType) => void;
    onScheduleChange: (next: string, duration?: string) => void;
    onSuccessChange: (next: FlowNodeSuccess) => void;
    onStatusChange: (next: FlowNodeStatus) => void;
    onOpenChat: () => void;
    onUnlinkChat: () => void;
}

/** The editor itself, drawn into the stack panel `FlowNodeEditorPanel` is pushed as. */
const FlowNodeEditor: React.FC<FlowNodeEditorProps> = ({
    readOnly, title, body, note, valueText, valueError, valueType, onNoteChange, onValueTextChange, onValueTypeChange,
    outputType, output, onOutputTypeChange,
    tags, type, settings, at, duration, success, content, boardHandle, flowNodeId, status, chat,
    criteria, complexity,
    showClaude, onTitleChange, onBodyChange, onTagsChange, onCriteriaChange, onComplexityChange,
    onMetaChange, onTypeChange, onScheduleChange, onSuccessChange, onStatusChange,
    onOpenChat, onUnlinkChat,
}) => {
    const controls = useMarkdownEditorControls();
    const ownNode = content.flowNodes.find(one => one.id === flowNodeId);
    const valueSchema = ownNode ? resolvedValueSchema(content, ownNode) as JsonSchema | undefined : undefined;

    if (type === 'note' || type === 'value') {
        return (
            <div className={styles.editorBody} data-testid="flow-node-editor">
                {type === 'value' && (
                    <div className={styles.editorTitleRow}>
                        <Input
                            className={styles.editorTitleInput}
                            value={title}
                            placeholder="Value title"
                            aria-label="Value title"
                            data-testid="flow-node-editor-title"
                            onChange={event => onTitleChange(event.target.value)}
                        />
                    </div>
                )}
                {type === 'note' ? (
                    <div className={styles.editorPanes}>
                        <div className={styles.editorColumn}>
                            <div className={styles.editorMain}>
                                <MarkdownEditorBody
                                    ref={controls.editorRef}
                                    {...controls.bodyProps}
                                    value={note}
                                    onChange={onNoteChange}
                                    pdfTitle="note"
                                    extensions={markdownLinkDrop}
                                    imageFolder={boardHandle ? boardFolder(boardHandle) : ''}
                                    imageDocumentName={boardHandle || 'flowNode'}
                                    imageLinksFromRoot
                                />
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className={styles.editorRow}>
                            <ValueTypeSelect
                                valueType={valueType}
                                content={content}
                                flowNodeId={flowNodeId}
                                onChange={onValueTypeChange}
                            />
                        </div>
                        <FlowNodeValueEditor
                            key={flowNodeId}
                            value={valueText}
                            onChange={onValueTextChange}
                            error={valueError}
                            testId="flow-node-editor-value"
                            schema={valueSchema}
                        />
                    </>
                )}
            </div>
        );
    }

    return (
        <div className={styles.editorBody} data-testid="flow-node-editor">
            <div className={styles.editorTitleRow}>
                <Input
                    className={styles.editorTitleInput}
                    value={title}
                    placeholder="Node title"
                    aria-label="Node title"
                    data-testid="flow-node-editor-title"
                    onChange={event => onTitleChange(event.target.value)}
                />
            </div>
            <div className={styles.editorTools}>
                {showClaude && (
                    <FlowNodePlaySettings
                        readOnly={readOnly}
                        key={flowNodeId}
                        type={type}
                        settings={settings}
                        at={at} duration={duration}
                        success={success}
                        chat={chat}
                        onMetaChange={onMetaChange}
                        onTypeChange={onTypeChange}
                        onScheduleChange={onScheduleChange}
                        onSuccessChange={onSuccessChange}
                        onOpenChat={onOpenChat}
                        onUnlinkChat={onUnlinkChat}
                    />
                )}
                { }
                {showClaude && isForAgent(type) && boardHandle && (
                    <div className={styles.editorRow}>
                        <FlowNodeCosts handle={boardHandle} flowNodeId={flowNodeId} />
                    </div>
                )}
                { }
                <div className={styles.editorRow}>
                    <StatusSelect status={status} onChange={onStatusChange} />
                    <TagsControl
                        tags={tags}
                        onChange={onTagsChange}
                        className={styles.editorTags}
                    />
                    {showClaude && chains(type) && (
                        <NextFlowNodeSelect
                            success={success}
                            content={content}
                            flowNodeId={flowNodeId}
                            multiple={type === 'gateway'}
                            onChange={onSuccessChange}
                            disabled={readOnly}
                        />
                    )}
                </div>

                <div className={styles.editorRow}>
                    {showClaude && hasFolder(type) && (
                        <FolderInput
                            settings={settings}
                            required={isForAgent(type)}
                            onChange={onMetaChange}
                            disabled={readOnly}
                        />
                    )}
                    {isTask(type) && !readOnly && (
                        <div className={styles.editorToolbar}>
                            <FlowNodeTemplateSelect host={BOARD_TAB_ID} />
                            <MarkdownEditorToolbar {...controls.toolbarProps} />
                        </div>
                    )}
                </div>
            </div>
            {isTask(type) && (
                <div className={styles.editorRow}>
                    <FlowNodeOutput outputType={outputType} output={output} onChange={onOutputTypeChange} disabled={readOnly} />
                </div>
            )}
            {isTask(type) && (
                <div className={styles.editorRow}>
                    <ComplexitySelect complexity={complexity} onChange={onComplexityChange} />
                </div>
            )}
            {isTask(type) && (
                <div className={styles.editorPanes}>
                    <div className={styles.editorColumn}>
                        <div className={styles.editorMain}>
                            {readOnly ? (
                                <ConfiguredMarkdown className={styles.descriptionPreview} documentFolder="">{body}</ConfiguredMarkdown>
                            ) : (
                                <MarkdownEditorBody
                                    ref={controls.editorRef}
                                    {...controls.bodyProps}
                                    value={body}
                                    onChange={onBodyChange}
                                    pdfTitle={title || 'flowNode'}
                                    extensions={markdownLinkDrop}
                                    imageFolder={boardHandle ? boardFolder(boardHandle) : ''}
                                    imageDocumentName={boardHandle || 'flowNode'}
                                    imageLinksFromRoot
                                />
                            )}
                        </div>
                    </div>
                </div>
            )}
            {isTask(type) && (
                <SuccessCriteriaEditor criteria={criteria} onChange={onCriteriaChange} readOnly={readOnly} />
            )}
        </div>
    );
};

interface FlowNodePlaySettingsProps {
    readOnly: boolean;
    type: FlowNodeType;
    settings: FlowNodeSettings;
    at: string;
    duration?: string;
    success: FlowNodeSuccess;
    chat: string;
    onMetaChange: (changes: SettingsChanges) => void;
    onTypeChange: (next: FlowNodeType) => void;
    onScheduleChange: (next: string, duration?: string) => void;
    onSuccessChange: (next: FlowNodeSuccess) => void;
    onOpenChat: () => void;
    onUnlinkChat: () => void;
}

/**
 * The row about the play: **what kind of card this is**, and — where the answer asks for more —.
 * The type opens the row because it is what decides how much of the row there is: a *Human* card.
 */
const FlowNodePlaySettings: React.FC<FlowNodePlaySettingsProps> = ({
    readOnly, type, settings, at, duration, success, chat, onMetaChange, onTypeChange, onScheduleChange,
    onSuccessChange, onOpenChat, onUnlinkChat,
}) => {
    const { agents: managed } = useAgents();
    const { runners } = useRunners();
    const { agents: engines, optionsFor } = useChatOptions();
    const forAgent = isForAgent(type);
    const own = optionsFor(settingsPlatform(settings, managed) || engines[0]?.value || '');
    const definition = managed.find(one => one.id === settings.agent);
    const agent = definition?.published ?? definition;
    const profile = profileForAgent(own, agent);
    const efforts = effortsForAgent(own, agent);

    return (
        <div className={styles.editorRow}>
            <TypeSelect type={type} onChange={onTypeChange} />
            {type === 'scheduler' && <ScheduleInput at={at} duration={duration} onChange={onScheduleChange} />}
            {forAgent && (
                <>
                    <AgentSelect settings={settings} agents={managed} onChange={onMetaChange} disabled={readOnly} />
                    <EffortSelect settings={settings} options={efforts} onChange={onMetaChange} disabled={readOnly} />
                    <PermissionSelect
                        settings={settings}
                        options={own.permissionModes}
                        onChange={onMetaChange}
                        disabled={readOnly}
                    />
                    {agent?.profileId && !profile && <span role="status">Profile {agent.profileId} is unavailable on this runner.</span>}
                    {profile && profile.status !== 'ready' && <span role="status">{profile.message || profile.status}</span>}
                    <RunnerSelect settings={settings} runners={runners} onChange={onMetaChange} />
                    <CompactCheck success={success} settings={settings} onChange={onSuccessChange} disabled={readOnly} />
                    <TransitionModeSelect
                        success={success}
                        settings={settings}
                        onChange={onSuccessChange}
                        disabled={readOnly}
                    />
                </>
            )}
            {forAgent && <ChatLink chat={chat} onOpen={onOpenChat} onUnlink={onUnlinkChat} />}
        </div>
    );
};
