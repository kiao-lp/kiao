import React from 'react';
import { Input } from 'antd';
import { markdownLinkDrop } from '@cms-core';
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
    TransitionModeSelect, TypeSelect,
} from './FlowNodeControls';
import { FlowNodeTemplateSelect } from './FlowNodeTemplateSelect';
import { FlowNodeCosts } from './FlowNodeCosts';
import styles from '../Hybridflow.module.css';

/**
 * The open flow node over the board: the markdown editor every `.md` file gets — source, live preview,
 * and the toolbar that folds, inserts and exports them — with the flow node's title on the row above
 * and everything else about it on the rows between.
 *
 * It edits the open flow node itself rather than a copy of it, through the same calls the panel makes
 * and into the same draft (`FlowNodeEditing-ctx`), so there is nothing to apply and nothing to lose:
 * what is typed here is on the board as it is typed, and closing is closing. Like everywhere else
 * in this CMS, there is no Save button.
 *
 * It fills the **central area** and stops there, as a panel on its stack (`ExpandedFlowNode` pushes
 * it): the tool bars stay where they are — which is where this editor was opened from, where the
 * played chat is watched and where the panel shows the same flow node. What it covers is the board,
 * which is what it is an editor of. Nothing is trapped in it: the bars stay usable behind it, and
 * a file dragged out of the tree still lands as a link in the description.
 *
 * **The title is a box on the first row**, the width of it. The header used to name the flow node
 * as well, which was a heading over a field holding the same words one row below: the title is
 * read where it is written.
 *
 * Under it are three rows, and each is a question of its own: **what kind of card it is and what
 * plays it** — the type, and behind it the agent, the effort, the permission mode or a Scheduler's
 * datetime, what becomes of the conversation, and the way into the chat it was played in; **where
 * it stands** — the status, the tags it is filed under and the flow node it hands on to; and **where the
 * flow node is** — the folder, with the writing tools keeping the end of that row.
 *
 * Every row is as long as the type says. A *Human* card is asked none of what plays it, so the first
 * row is the type alone; a *Scheduler* is asked for its datetime and keeps its chain; a *Shutdown*
 * is asked nothing at all, so the chain goes from the second row and the folder from the third. What
 * every card keeps is where it stands and what it is filed under, which are true of work whoever
 * does it and whenever it happens.
 *
 * The folder's row is last, against the panes, because of what shares it: a toolbar reads as
 * belonging to whatever it touches, and what these buttons act on is the editor below them. Left in
 * the middle of the banner they were a row of settings, which is what they sat among.
 *
 * The panes hold the **description** — what is sent when the flow node is played. A play sends it and
 * leaves it exactly where it is, so the card is a thing to write in, play and play again. They are
 * drawn for a **task** — an AI card or a Human card, which is to say a card that is work somebody
 * does — and for nothing else: a Shutdown and a Scheduler describe no work, and the store keeps no
 * description for a card that is not a task.
 *
 * On that last row too is the **template** the description is written from — the same select the
 * panel carries, and the same pick, the two faces sharing one draft. Instantiating it pushes a
 * panel over this one on the stack, and closing that is back here.
 */
export const FlowNodeEditorPanel: React.FC = () => {
    const { content, handle, selectedFlowNode } = useHybridflow();
    const {
        title, body, note, valueText, valueError, editTitle, editBody, editNote, editValueText,
        editTags, editCriteria, editComplexity,
        editMeta, editType, editSchedule, editSuccess, editStatus, unlinkChat,
    } = useFlowNodeEditing();
    const agentAvailable = useChatAvailable();

    const flowNode = selectedFlowNode?.flowNode ?? null;
    const openChat = useOpenFlowNodeChat(flowNode?.chat ?? '');

    if (!flowNode || !content) return null;

    return (
        <FlowNodeEditor
            title={title}
            body={body}
            note={note}
            valueText={valueText}
            valueError={valueError}
            onNoteChange={editNote}
            onValueTextChange={editValueText}
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
    /**
     * The flow node's title and its description, as `FlowNodeEditing-ctx` holds them for both faces
     * of the editor. The description is what is sent when the flow node is played.
     */
    title: string;
    body: string;
    note: string;
    valueText: string;
    valueError: string;
    onNoteChange: (next: string) => void;
    onValueTextChange: (next: string) => void;
    /** The words the card is filed under. */
    tags: string[];
    /** What kind of card it is: what decides how much of the first row there is. */
    type: FlowNodeType;
    settings: FlowNodeSettings;
    /** The Scheduler's datetime, and `''` on every other type. */
    at: string;
    duration?: string;
    /** What the flow node hands on to when it comes back an answer. */
    success: FlowNodeSuccess;
    /** The board a chain is picked from — any card of it may be named. */
    content: BoardContent;
    /** The board's handle, naming the folder a pasted image belongs in — null while none is open. */
    boardHandle: string | null;
    /** The open flow node, which is not offered to itself. */
    flowNodeId: string;
    /** Where the flow node stands, and the chat it was played in: the two a play writes for itself. */
    status: FlowNodeStatus;
    chat: string;
    /** What done means, and how heavy it looks — the task's own two, drawn for a task only. */
    criteria: SuccessCriterion[];
    complexity: TaskComplexity;
    /**
     * Whether a chat is part of the build at all. Where none is, there is no agent to pick, no
     * chat to link to and no chain for a play to follow, so the flow node is a title, a status and a
     * body.
     */
    showClaude: boolean;
    onTitleChange: (next: string) => void;
    onBodyChange: (next: string) => void;
    onTagsChange: (next: string[]) => void;
    onCriteriaChange: (next: SuccessCriterion[]) => void;
    onComplexityChange: (next: TaskComplexity) => void;
    onMetaChange: (changes: SettingsChanges) => void;
    /** Typing the card, which is the question the settings row hangs off. */
    onTypeChange: (next: FlowNodeType) => void;
    onScheduleChange: (next: string, duration?: string) => void;
    onSuccessChange: (next: FlowNodeSuccess) => void;
    onStatusChange: (next: FlowNodeStatus) => void;
    onOpenChat: () => void;
    onUnlinkChat: () => void;
}

/**
 * The editor itself, drawn into the stack panel `FlowNodeEditorPanel` is pushed as. The stack's frame
 * carries the floating cross; everything here is the flow node.
 */
const FlowNodeEditor: React.FC<FlowNodeEditorProps> = ({
    title, body, note, valueText, valueError, onNoteChange, onValueTextChange,
    tags, type, settings, at, duration, success, content, boardHandle, flowNodeId, status, chat,
    criteria, complexity,
    showClaude, onTitleChange, onBodyChange, onTagsChange, onCriteriaChange, onComplexityChange,
    onMetaChange, onTypeChange, onScheduleChange, onSuccessChange, onStatusChange,
    onOpenChat, onUnlinkChat,
}) => {
    const controls = useMarkdownEditorControls();

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
                        <Input.TextArea
                            value={valueText}
                            aria-label="Value JSON"
                            data-testid="flow-node-editor-value"
                            autoSize={{ minRows: 12 }}
                            onChange={event => onValueTextChange(event.target.value)}
                        />
                        {valueError && <div data-testid="flow-node-value-error">{valueError}</div>}
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
                {/* What the card spent, between what plays it and where it stands: an AI
                    card's alone — a Human card's turns file no usage, and the other two are
                    played by no turn at all. */}
                {showClaude && isForAgent(type) && boardHandle && (
                    <div className={styles.editorRow}>
                        <FlowNodeCosts handle={boardHandle} flowNodeId={flowNodeId} />
                    </div>
                )}
                {/* Where the flow node stands, what it is filed under, and what it hands on to:
                    the status says one short word and takes the width of it, the tags and
                    the chain share the rest. */}
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
                        />
                    )}
                </div>
                {/* Where the flow node is, and what it is written with — the last row of the
                    banner, against the panes. A toolbar reads as belonging to whatever it
                    touches, and what it acts on is the editor below it, not the rows of
                    settings it would otherwise be sitting among. The folder takes the rest
                    of that row, a path being the longest line the banner holds. */}
                <div className={styles.editorRow}>
                    {showClaude && hasFolder(type) && (
                        <FolderInput
                            settings={settings}
                            required={isForAgent(type)}
                            onChange={onMetaChange}
                        />
                    )}
                    {isTask(type) && (
                        <div className={styles.editorToolbar}>
                            <FlowNodeTemplateSelect />
                            <MarkdownEditorToolbar {...controls.toolbarProps} />
                        </div>
                    )}
                </div>
            </div>
            {/* What done means and how heavy it looks, above the description: the task's own two,
                drawn for a task and for nothing else — a Shutdown and a Scheduler describe no work,
                so there is nothing of theirs to measure or to weigh. */}
            {isTask(type) && (
                <div className={styles.editorRow}>
                    <ComplexitySelect complexity={complexity} onChange={onComplexityChange} />
                </div>
            )}
            {isTask(type) && (
                <SuccessCriteriaEditor criteria={criteria} onChange={onCriteriaChange} />
            )}
            {/* The description, filling the column: what is being asked. Drawn for a task and for
                nothing else — a Shutdown and a Scheduler describe no work, so there is nothing to
                ask of them and nowhere for an answer to be kept. */}
            {isTask(type) && (
                <div className={styles.editorPanes}>
                    <div className={styles.editorColumn}>
                        <div className={styles.editorMain}>
                            <MarkdownEditorBody
                                ref={controls.editorRef}
                                {...controls.bodyProps}
                                value={body}
                                onChange={onBodyChange}
                                pdfTitle={title || 'flowNode'}
                                // A file dragged in from the tree lands as a link to it, as in the
                                // panel's own editor.
                                extensions={markdownLinkDrop}
                                // A pasted image belongs in the board's own folder, and its link is
                                // written from the store root — the same answer the panel gives, for
                                // the same card. Without it the browsed file's folder would seed both,
                                // which is wherever the reader last was rather than this board.
                                imageFolder={boardHandle ? boardFolder(boardHandle) : ''}
                                imageDocumentName={boardHandle || 'flowNode'}
                                imageLinksFromRoot
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

interface FlowNodePlaySettingsProps {
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
 * The row about the play: **what kind of card this is**, and — where the answer asks for more —
 * which agent runs it, at what effort, with what allowed to happen while nobody watches, what becomes of the
 * conversation once it is done, and the way into that conversation, or else the datetime a Scheduler
 * waits for.
 *
 * The type opens the row because it is what decides how much of the row there is: a *Human* card
 * gives up everything but the type, its questions being about a turn it will never have, and so
 * does a *Shutdown*; a *Scheduler* keeps the datetime it waits for and nothing else.
 *
 * A component of its own because it is where the lists are asked for — the options capability is a
 * request to the service, not a cache — and a build with no chat has nothing to ask for: the row is
 * not rendered, so the request is never made. They come **per platform**, and the card's own agent
 * is what picks the set the two selects beside it are drawn from.
 */
const FlowNodePlaySettings: React.FC<FlowNodePlaySettingsProps> = ({
    type, settings, at, duration, success, chat, onMetaChange, onTypeChange, onScheduleChange,
    onSuccessChange, onOpenChat, onUnlinkChat,
}) => {
    const { agents: managed } = useAgents();
    const { runners } = useRunners();
    const { agents: engines, optionsFor } = useChatOptions();
    const forAgent = isForAgent(type);
    // The card's own agent decides the two lists beside it: the effort and the permission modes are
    // its platform's vocabulary.
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
                    <AgentSelect settings={settings} agents={managed} onChange={onMetaChange} />
                    <EffortSelect settings={settings} options={efforts} onChange={onMetaChange} />
                    <PermissionSelect
                        settings={settings}
                        options={own.permissionModes}
                        onChange={onMetaChange}
                    />
                    {agent?.profileId && !profile && <span role="status">Profile {agent.profileId} is unavailable on this runner.</span>}
                    {profile && profile.status !== 'ready' && <span role="status">{profile.message || profile.status}</span>}
                    <RunnerSelect settings={settings} runners={runners} onChange={onMetaChange} />
                    <CompactCheck success={success} settings={settings} onChange={onSuccessChange} />
                    <TransitionModeSelect
                        success={success}
                        settings={settings}
                        onChange={onSuccessChange}
                    />
                </>
            )}
            {forAgent && <ChatLink chat={chat} onOpen={onOpenChat} onUnlink={onUnlinkChat} />}
        </div>
    );
};
