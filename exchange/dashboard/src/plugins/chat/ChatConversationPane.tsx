// It is a component rather than the body of the panel because the panel shows several at once — a pinned conversation gets a column.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Select, Button, Spin, Modal, message } from 'antd';
import { SendOutlined, StopOutlined, ExpandAltOutlined, BulbOutlined, BulbFilled } from '@ant-design/icons';
import type {
    HarnessConversation, HarnessConversationCreate, HarnessOptionsEntry, HarnessPermissionMode,
} from 'kiao-worker';
import { markdownLinkDropHandlers, Tooltip } from '@kiao-dashboard-core';
import { localizeNoticeDateTimes } from '@kiao-dashboard-kit/date-time';
import { MODEL_EFFORT_SEP, defaultModelEffortFor, splitModelEffort } from './chatDefaults';
import { useChatConversation } from './useChatConversation';
import type { SendOptions } from './useChatConversation';
import { useChatChainRuns } from './ChatChainRuns-ctx';
import type { ConversationRuntime } from './chatConversationReducer';
import { ChatMessageList } from './ChatMessageList';
import { ChatBackgroundTasks } from './ChatBackgroundTasks';
import { ChatPermissionRequests } from './ChatPermissionRequests';
import { ChatQuestions } from './ChatQuestions';
import { ChatErrorNotice } from './ChatErrorNotice';
import { useStickToBottom } from '@kiao-dashboard-core';
import {
    ChatAttachButton, ChatAttachmentStrip, filesFromDrop, filesFromPaste, useChatAttachments,
} from './ChatAttachments';


// instead, to keep working for a client that predates the field — this UI always states its choice, so the two never disagree.
const DEFAULT_PERMISSION_MODE: HarnessPermissionMode = 'manual';

export const PERMISSION_MODE_HELP: Record<HarnessPermissionMode, string> = {
    manual: 'Waits for your approval before running tool calls that require permission.',
    manualLive: 'Asks for approval; unanswered requests are allowed when their countdown expires.',
    bypassPermissions: 'Bypass: the harness runs every tool call without asking',
};

const PERMISSION_MODE_SHORT: Record<string, string> = {
    manual: 'Manual',
    manualLive: 'Live',
    bypassPermissions: 'Bypass',
};

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// The grip is a few pixels in the one corner the Send button crowds, and it only ever grows the box
const MIN_PROMPT_HEIGHT = 58;
/** How far one arrow-key press moves the bar — a line or so of the box's own text. */
const PROMPT_HEIGHT_STEP = 24;
/**
 * What the box is never allowed to take from the column it is in: the controls row underneath it,.
 * Without it a box dragged past the column's own height pushes its own toolbar out of the bottom of.
 */
const PROMPT_HEIGHT_ROOM = 120;

/** The column that holds the list, as a pane key. */
export const MAIN_PANE = 'main';

export interface ChatConversationPaneProps {

    paneKey: string;

    conversationId: string | null;

    conversation: HarnessConversation | null;

    currentPath: string;

    harnesses: HarnessOptionsEntry[];

    optionsFor: (harness: string) => HarnessOptionsEntry;

    restoredPrompt: { paneKey: string; text: string; attachments: string[] } | null;

    onCreate?: (body: HarnessConversationCreate) => Promise<HarnessConversation>;

    canStart?: (harness: string) => Promise<boolean>;

    promptRef?: React.RefObject<HTMLTextAreaElement>;

    settingsRef?: React.MutableRefObject<NewConversationSettings | null>;

    onForkProfile?: (conversationId: string, profileId: string) => void;
    onFork?: (conversationId: string, messageId: string, text: string) => void;
}

/** What a starter makes a conversation with: everything the toolbar is showing, the harness included. */
export type NewConversationSettings = SendOptions & { harness: string; profileId?: string };

export const ChatConversationPane: React.FC<ChatConversationPaneProps> = ({
    paneKey, conversationId, conversation, currentPath, harnesses, optionsFor,
    restoredPrompt, onCreate, canStart, promptRef, settingsRef, onFork, onForkProfile,
}) => {
    const {
        messages, running, background, permissionRequests, questionRequests, lastError,
        notice: driverNotice,
        loading: transcriptLoading, send, sendBetween, sendFollowUp, clearQueue, queue, stop, decidePermission, answerQuestions,
    } = useChatConversation(conversationId);
    const { runs, stop: stopRun, resume: resumeRun } = useChatChainRuns();
    const suspendedHere = useMemo(
        () => runs.find(candidate => candidate.state === 'suspended' && candidate.chat === conversationId),
        [runs, conversationId],
    );
    const [prompt, setPrompt] = useState('');
    const [heldModelEffort,holdModelEffort] = useState({ owner: '', value: '' });
    const [thinking, setThinking] = useState(true);
    const [permissionMode, setPermissionMode] = useState<HarnessPermissionMode>(DEFAULT_PERMISSION_MODE);
    const [expandedModalOpen, setExpandedModalOpen] = useState(false);
    const [authPending, setAuthPending] = useState(false);
    const [draftProfile,setDraftProfile]=useState('');
    const [delivery,setDelivery]=useState<'steer'|'followUp'>('steer');
    const files = useChatAttachments();
    const [dragOver, setDragOver] = useState(false);

    // The harness this pane is speaking to: the conversation's where there is one, and otherwise
    const harness = conversation?.harness || harnesses[0]?.value || '';
    const modelOwner = conversationId || harness;
    const modelEffort = heldModelEffort.owner === modelOwner ? heldModelEffort.value : '';
    const setModelEffort = useCallback((value: string) => holdModelEffort({owner:modelOwner,value}),[modelOwner]);
    const harnessAvailable = harnesses.some(entry => entry.value === harness);
    const own = useMemo(() => optionsFor(harness), [optionsFor, harness]);
    const profileId = conversation?.profileId || draftProfile || own.defaultProfileId || '';
    const profile = own.profiles?.find(one => one.id === profileId);
    const models = profile?.models ?? own.models;
    const efforts = profile ? [...new Map(profile.models.flatMap(one => one.efforts).map(one => [one.value, one])).values()] : own.efforts;
    const permissionModes = own.permissionModes;

    const fixedModel = conversation?.agentVersion ? conversation.model : undefined;
    const modelEffortGroups = useMemo(() => models.filter(m => !fixedModel || m.value === fixedModel).map(m => ({
        label: m.label,
        title: m.label,
        options: (profile?.models.find(one => one.value === m.value)?.efforts ?? efforts).map(e => ({
            value: `${m.value}${MODEL_EFFORT_SEP}${e.value}`,
            label: `${m.label} · ${e.label}`,
        })),
    })), [models, efforts, profile, fixedModel]);

    // The service owns the list of modes; the client only shortens their names — see `PERMISSION_MODE_SHORT`.
    const permissionModeOptions = useMemo(
        () => permissionModes.map(m => ({
            value: m.value as HarnessPermissionMode,
            label: PERMISSION_MODE_SHORT[m.value] ?? m.label,
        })),
        [permissionModes],
    );

    // It can only be `bypassPermissions` on a deployment that withdrew it — gone from the option list, but still stored on.
    useEffect(() => {
        if (!permissionModeOptions.length) return;
        if (permissionModeOptions.some(o => o.value === permissionMode)) return;
        const fallback = permissionModeOptions.find(o => o.value === DEFAULT_PERMISSION_MODE)
            ?? permissionModeOptions[0];
        setPermissionMode(fallback.value);
    }, [permissionModeOptions, permissionMode]);

    const defaultModelEffort = useMemo(() => {
        if (!models.length || !efforts.length) return '';
        if (profile) {
            const selected=profile.models.find(one => one.value === profile.defaultModel) ?? profile.models[0];
            return selected ? `${selected.value}${MODEL_EFFORT_SEP}${profile.defaultEffort || selected.efforts[0]?.value || ''}` : '';
        }
        const { model, effort } = defaultModelEffortFor(own);
        return `${model}${MODEL_EFFORT_SEP}${effort}`;
    }, [own, profile, models, efforts]);

    const storedModelEffort = conversation
        ? `${conversation.model}${MODEL_EFFORT_SEP}${conversation.effort}`
        : '';
    const hasStoredModelEffort = Boolean(conversation?.model || conversation?.effort);
    const storedPermissionMode = conversation?.permissionMode;
    const storedThinking = conversation?.thinking;

    useEffect(() => {
        if (hasStoredModelEffort) return;
        const valid = modelEffortGroups.some(g => g.options.some(o => o.value === modelEffort));
        if (!valid && defaultModelEffort) setModelEffort(defaultModelEffort);
    }, [hasStoredModelEffort, modelEffortGroups, defaultModelEffort, modelEffort]);

    useEffect(() => {
        if (!storedModelEffort || storedPermissionMode === undefined || storedThinking === undefined) return;
        setModelEffort(storedModelEffort);
        setPermissionMode(storedPermissionMode);
        setThinking(storedThinking);
    }, [storedModelEffort, storedPermissionMode, storedThinking]);

    const selectedModelEffort = modelEffort || storedModelEffort || defaultModelEffort;
    const { model, effort } = splitModelEffort(selectedModelEffort);
    const capabilities = profile?.models.find(one => one.value === model)?.capabilities ?? own.capabilities;
    const modelEffortOptions = useMemo(() => {
        if (!model || !effort || modelEffortGroups.some(g => g.options.some(o => o.value === selectedModelEffort))) {
            return modelEffortGroups;
        }
        const modelIndex = modelEffortGroups.findIndex(group => group.options.some(option => splitModelEffort(option.value).model === model));
        const modelLabel = models.find(one => one.value === model)?.label ?? model;
        const effortLabel = efforts.find(e => e.value === effort)?.label ?? effort;
        const option = { value: selectedModelEffort, label: `${modelLabel} · ${effortLabel}` };
        if (modelIndex >= 0) {
            return modelEffortGroups.map((group, index) => index === modelIndex
                ? { ...group, options: [...group.options, option] }
                : group);
        }
        return [...modelEffortGroups, { label: modelLabel, title: modelLabel, options: [option] }];
    }, [modelEffortGroups, models, efforts, selectedModelEffort, model, effort]);
    const sendOptions: SendOptions = { model, effort, thinking, permissionMode };

    const boxPurpose = running
        ? 'Add to what the turn is doing…'
        : conversationId ? 'Continue the conversation…' : 'Ask the harness…';
    const promptPlaceholder = `${boxPurpose} (Ctrl+Enter)`;

    const sendHelp = running
        ? 'The running turn reads this at its next step, keeping its current settings.'
        : files.uploading ? 'Waiting for the attachments to finish uploading' : '';

    useEffect(() => {
        if (settingsRef) settingsRef.current = { ...sendOptions, harness, profileId: profileId || undefined };
    });

    const [dismissedError, setDismissedError] = useState<ConversationRuntime['lastError']>(null);
    const notice = lastError === dismissedError ? null : lastError;

    // The transcript follows the newest message only for a reader who is at the bottom of it — see useStickToBottom.
    const stick = useStickToBottom(messages);
    const ownTextareaRef = useRef<HTMLTextAreaElement>(null);
    const textareaRef = promptRef ?? ownTextareaRef;
    const expandedTextareaRef = useRef<HTMLTextAreaElement>(null);

    const [promptHeight, setPromptHeight] = useState<number | null>(null);
    // Where the drag started, in the pointer's coordinates and in the box's.
    const dragFrom = useRef<{ pointerY: number; height: number } | null>(null);

    const maxPromptHeight = () => {
        const pane = textareaRef.current?.closest('.chat-pane')?.getBoundingClientRect().height ?? 0;
        const ceiling = pane > PROMPT_HEIGHT_ROOM ? pane - PROMPT_HEIGHT_ROOM : window.innerHeight * 0.7;
        return Math.round(Math.max(ceiling, MIN_PROMPT_HEIGHT));
    };

    const clampHeight = (height: number) => Math.min(Math.max(height, MIN_PROMPT_HEIGHT), maxPromptHeight());

    const currentHeight = () => promptHeight
        || textareaRef.current?.getBoundingClientRect().height
        || MIN_PROMPT_HEIGHT;

    const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
        // Captured on the bar, so a pointer that runs off it — or off the panel — keeps resizing until it is let go, instead of dropping.
        e.currentTarget.setPointerCapture?.(e.pointerId);
        dragFrom.current = { pointerY: e.clientY, height: currentHeight() };
        // Otherwise the drag selects the transcript it is dragged across.
        e.preventDefault();
    };

    const onResize = (e: React.PointerEvent<HTMLDivElement>) => {
        const from = dragFrom.current;
        if (!from) return;
        setPromptHeight(clampHeight(from.height + (from.pointerY - e.clientY)));
    };

    const endResize = (e: React.PointerEvent<HTMLDivElement>) => {
        dragFrom.current = null;
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    };

    // The bar is a control and not just a texture, so it answers the arrow keys too — a pointer drag is not the only way to reach.
    const resizeByKey = (e: React.KeyboardEvent) => {
        const step = e.key === 'ArrowUp' ? PROMPT_HEIGHT_STEP : e.key === 'ArrowDown' ? -PROMPT_HEIGHT_STEP : 0;
        if (!step) return;
        e.preventDefault();
        setPromptHeight(clampHeight(currentHeight() + step));
    };

    // The text of a prompt that never left goes back in front of what is being typed now rather than replacing it: neither is this.
    const takenDrop = useRef<ChatConversationPaneProps['restoredPrompt']>(null);
    useEffect(() => {
        if (!restoredPrompt || restoredPrompt.paneKey !== paneKey) return;
        if (takenDrop.current === restoredPrompt) return;
        takenDrop.current = restoredPrompt;
        setPrompt(current => (current ? `${restoredPrompt.text}\n\n${current}` : restoredPrompt.text));
        // The files are still on the server; only the chips naming them were let go when the box sent.
        files.restore(restoredPrompt.attachments);
    }, [restoredPrompt, paneKey, files.restore]);

    // A prompt typed with no conversation selected makes one first.
    const [pendingPrompt, setPendingPrompt] = useState<{ id: string; text: string; opts: SendOptions } | null>(null);

    useEffect(() => {
        if (!pendingPrompt || pendingPrompt.id !== conversationId) return;
        setPendingPrompt(null);
        send(pendingPrompt.text, pendingPrompt.opts);
    }, [pendingPrompt, conversationId, send]);

    // Nothing to send, or nothing that can be sent yet.
    const canSend = !authPending && harnessAvailable && (running
        ? !!prompt.trim()
        : (!!prompt.trim() || files.ids.length > 0) && !files.uploading);

    // A between the service refused reached nobody, so the text is the user's again.
    const sentBetween = useRef<string | null>(null);
    useEffect(() => {
        const text = sentBetween.current;
        if (!text || lastError?.code !== 'no_running_turn') return;
        sentBetween.current = null;
        setPrompt(current => (current ? `${text}\n\n${current}` : text));
    }, [lastError]);


    const askAboutTheRun = (): Promise<void> | null => {
        // Null rather than a resolved promise: an ordinary message must not wait a tick on a question nobody is being asked.
        if (!conversationId || !suspendedHere) return null;
        const runId = suspendedHere.id;
        return new Promise<void>(resolve => Modal.confirm({
            title: 'Carry on with the board?',
            content: 'The board’s play stopped with this conversation. Sending this message can pick '
                + 'it back up: what the harness answers is filed under the flow node that was playing, and the '
                + 'chain carries on from there.',
            okText: 'Yes, carry on',
            cancelText: 'No, this message only',
            onOk: () => resumeRun(runId).finally(resolve),
            onCancel: () => { stopRun(runId); resolve(); },
        }));
    };

    const checkingAuth = useRef(false);
    const sendTarget = useRef('');
    sendTarget.current = JSON.stringify([
        conversationId, harness, prompt, running, model, effort, permissionMode, thinking, harnessAvailable,
        files.attachments.map(file => [file.key, file.stored?.id, file.error]),
    ]);
    const doSend = async () => {
        const text = prompt.trim();
        if (!canSend || checkingAuth.current) return;
        if (!running && harness === 'codex' && canStart) {
            const target = sendTarget.current;
            checkingAuth.current = true;
            setAuthPending(true);
            try {
                if (!await canStart(harness)) return;
                // The user can switch conversations or edit while the host is being checked.
                if (sendTarget.current !== target) return;
            } finally {
                checkingAuth.current = false;
                setAuthPending(false);
            }
        }
        // Into the turn that is running, rather than starting one.
        if (running) {
            setPrompt('');
            stick.follow();
            sentBetween.current = text;
            if (delivery === 'followUp' && capabilities?.followUp) sendFollowUp(text); else sendBetween(text);
            return;
        }
        const opts: SendOptions = { ...sendOptions, attachments: files.ids };
        setPrompt('');
        // Back to the bottom, whatever the user had scrolled back to read: they are adding to the end of the conversation, and the reply.
        stick.follow();
        if (conversationId) {
            files.clear();
            const asked = askAboutTheRun();
            if (asked) void asked.then(() => send(text, opts));
            else send(text, opts);
            return;
        }
        // Only the main column can be here, and it is the one pane given `onCreate`.
        onCreate?.({ folder: currentPath, harness, profileId: profileId || undefined, model, effort, permissionMode, thinking })
            .then(created => {
                // Let go of the chips only once the conversation exists.
                files.clear();
                setPendingPrompt({ id: created.id, text, opts });
            })
            .catch(e => {
                // The text goes back in the box: it is the user's, and a create that failed is answered by fixing what it named and sending again.
                setPrompt(text);
                message.error(`Could not create a conversation: ${errorText(e)}`);
            });
    };

    // Files arriving from a paste, a drop or the picker.
    const takeFiles = (incoming: File[]) => {
        if (!incoming.length) return;
        files.add(incoming).forEach(refusal => message.warning(`Not attached: ${refusal}`));
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        const pasted = filesFromPaste(e.clipboardData);
        if (!pasted.length) return;
        // Only when this is a paste of files and not of text — see filesFromPaste.
        e.preventDefault();
        takeFiles(pasted);
    };

    // A file dragged in from the file tree is not an attachment but a **link** to a file the CLI can already open where it stands,.
    const linkDrop = markdownLinkDropHandlers(prompt, setPrompt);

    const handleDrop = (e: React.DragEvent) => {
        const dropped = filesFromDrop(e.dataTransfer);
        setDragOver(false);
        if (!dropped.length) return;
        e.preventDefault();
        takeFiles(dropped);
    };

    // Both are needed for a drop to fire at all: without preventDefault on dragover the browser navigates to the file instead,.
    const handleDragOver = (e: React.DragEvent) => {
        if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
        e.preventDefault();
        setDragOver(true);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            doSend();
        }
    };

    const handleExpandedKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            setExpandedModalOpen(false);
            doSend();
        }
    };

    return (
        <div
            className={`chat-pane${dragOver ? ' chat-pane--drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
        >
            {/* Shown only while something is being dragged over the column, so the drop has a visible target rather than being a thing. */}
            {dragOver && (
                <div className="chat-drop-overlay">Drop to attach to your next message</div>
            )}

            {conversation?.agentVersion && <details data-testid="conversation-agent-version">
                <summary>{conversation.agentVersion.name} · v{conversation.agentVersion.version} · {conversation.agentVersion.harness} · {conversation.model}</summary>
                <div>Agent: {conversation.agentVersion.agentId}</div>
                <div>Published: {conversation.agentVersion.publishedAt}</div>
                {conversation.profileId && <div>Execution profile: {conversation.profileId}</div>}
                <pre style={{ whiteSpace: 'pre-wrap' }}>{conversation.agentVersion.instructions || 'No standing instructions'}</pre>
            </details>}

            {/* Message history — the spinner only ever stands in for a transcript on its way ── */}
            {conversationId && transcriptLoading ? (
                <div className="chat-messages-loading"><Spin size="small" /></div>
            ) : (
                <ChatMessageList
                    messages={messages}
                    stick={stick}
                    folder={conversation?.folder ?? currentPath}
                    conversationId={conversationId}
                    onFork={onFork && conversationId && !running
                        ? message => onFork(conversationId, message.id, message.content)
                        : undefined}
                />
            )}


            <ChatPermissionRequests requests={permissionRequests} onDecide={decidePermission} />


            <ChatQuestions requests={questionRequests} onAnswer={answerQuestions} />


            <ChatErrorNotice error={notice} onDismiss={() => setDismissedError(lastError)} />


            <ChatBackgroundTasks tasks={background} />
            {running && (queue ?? []).length > 0 && <div className="chat-queue" data-testid="chat-queue">
                {(queue ?? []).map(item => <div key={item.id}><strong>{item.state}</strong> · {item.text}</div>)}
                {running && queue.some(item => item.state === 'pending') && <Button size="small" onClick={clearQueue}>Cancel pending messages</Button>}
            </div>}

            {/* The driver's own remark about the live turn — a silence naming itself. */}
            {running && driverNotice && (
                <div className="chat-driver-notice" role="status">
                    <Spin size="small" />
                    <span className="chat-driver-notice-text">{localizeNoticeDateTimes(driverNotice)}</span>
                </div>
            )}


            <div className="chat-input-area">

                <div
                    className="chat-prompt-grip"
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Resize the message box"
                    tabIndex={0}
                    onPointerDown={startResize}
                    onPointerMove={onResize}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                    onKeyDown={resizeByKey}
                />

                <ChatAttachmentStrip
                    attachments={files.attachments}
                    onRemove={files.remove}
                    disabled={running}
                />
                <textarea
                    ref={textareaRef}
                    className="chat-textarea"
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    {...linkDrop}
                    placeholder={promptPlaceholder}
                    aria-label={running ? 'Message for the running turn' : 'Message for the harness'}
                    rows={3}
                    style={promptHeight === null ? undefined : { height: promptHeight }}
                />

                <div className="chat-controls">
                    {own.profiles && <Tooltip title={conversation?.agentVersion ? 'Execution profile fixed by the published agent version' : conversationId ? 'Choose another profile to fork this conversation' : 'Execution profile for the new conversation'}>
                        <Select aria-label="Execution profile" size="small" style={{ minWidth: 140 }} value={profileId || undefined}
                            placeholder="Execution profile" disabled={running || !!conversation?.agentVersion}
                            options={own.profiles.map(one => ({value:one.id,label:one.name}))}
                            onChange={id => {if(conversationId && id!==profileId)onForkProfile?.(conversationId,id);else setDraftProfile(id);}} />
                    </Tooltip>}
                    {profile && profile.status !== 'ready' && <span role="status">{profile.message || profile.status}</span>}
                    {running && capabilities?.followUp && <Select aria-label="Message delivery" size="small" value={delivery} onChange={setDelivery}
                        options={[{value:'steer',label:'Steer now'},{value:'followUp',label:'After current work'}]} />}
                    {!running && capabilities?.compact && conversationId && <Button size="small" disabled={!conversation?.sessionId} onClick={() => send('/compact',sendOptions)}>Compact</Button>}
                    <Tooltip title={fixedModel ? 'Model fixed by the published agent version; effort applies to the next turn' : "Applies to the next turn and becomes this conversation's default."}>
                        <Select
                            size="small"
                            value={selectedModelEffort}
                            onChange={setModelEffort}
                            options={modelEffortOptions}
                            className="chat-model-effort-select"
                            classNames={{ popup: { root: 'chat-select-popup' } }}
                            popupMatchSelectWidth={false}
                            disabled={running || !harnessAvailable}
                        />
                    </Tooltip>


                    <Tooltip title={PERMISSION_MODE_HELP[permissionMode]}>
                        <Select<HarnessPermissionMode>
                            size="small"
                            value={permissionMode}
                            onChange={setPermissionMode}
                            options={permissionModeOptions}
                            className={`chat-permission-select${permissionMode === 'bypassPermissions' ? ' chat-permission-select--bypass' : ''}`}
                            classNames={{ popup: { root: 'chat-select-popup' } }}
                            popupMatchSelectWidth={false}
                            disabled={running || !harnessAvailable}
                            aria-label="Permission mode"
                        />
                    </Tooltip>


                    <Tooltip title={thinking ? 'Extended thinking: on (click to turn off)' : 'Extended thinking: off (click to turn on)'}>
                        <Button
                            size="small"
                            type={thinking ? 'primary' : 'default'}
                            icon={thinking ? <BulbFilled /> : <BulbOutlined />}
                            onClick={() => setThinking(t => !t)}
                            disabled={running || !harnessAvailable}
                            aria-pressed={thinking}
                            aria-label="Toggle extended thinking"
                        />
                    </Tooltip>

                    <div className="chat-buttons">

                        <ChatAttachButton onFiles={takeFiles} disabled={running || !harnessAvailable} />
                        <Button aria-label="Open in large editor"
                            size="small"
                            icon={<ExpandAltOutlined />}
                            onClick={() => setExpandedModalOpen(true)}
                        />

                        {running && (
                            <Button
                                danger
                                size="small"
                                icon={<StopOutlined />}
                                onClick={stop}
                            >
                                Stop
                            </Button>
                        )}
                        <Tooltip title={sendHelp}>
                            <Button
                                type="primary"
                                size="small"
                                icon={<SendOutlined />}
                                onClick={doSend}
                                loading={authPending}
                                disabled={!canSend}
                            >
                                Send
                            </Button>
                        </Tooltip>
                    </div>
                </div>
            </div>

            <Modal
                title="Edit message"
                open={expandedModalOpen}
                onCancel={() => setExpandedModalOpen(false)}
                width="80%"
                centered
                afterOpenChange={(open) => {
                    if (open) expandedTextareaRef.current?.focus();
                }}
                footer={[
                    <Button key="close" onClick={() => setExpandedModalOpen(false)}>
                        Close
                    </Button>,
                    <Button
                        key="send"
                        type="primary"
                        icon={<SendOutlined />}
                        disabled={!canSend}
                        onClick={() => {
                            setExpandedModalOpen(false);
                            doSend();
                        }}
                    >
                        Send (Ctrl+Enter)
                    </Button>,
                ]}
            >
                <ChatAttachmentStrip
                    attachments={files.attachments}
                    onRemove={files.remove}
                    disabled={running}
                />
                <textarea
                    ref={expandedTextareaRef}
                    className="chat-textarea-expanded"
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    onKeyDown={handleExpandedKeyDown}
                    onPaste={handlePaste}
                    {...linkDrop}
                    placeholder={boxPurpose}
                />
            </Modal>
        </div>
    );
};
