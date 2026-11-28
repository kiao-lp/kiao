// It is a component rather than the body of the panel because the panel shows several at once — a pinned conversation gets a column.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Select, Button, Spin, Modal, message } from 'antd';
import { SendOutlined, StopOutlined, BulbOutlined, BulbFilled } from '@ant-design/icons';
import type {
    HarnessConversation, HarnessOptionsEntry, HarnessPermissionMode,
} from 'kiao-worker';
import { IconButton, markdownLinkDropHandlers, Tooltip, useStickToBottom, VoiceInputButton } from '@kiao-dashboard-core';
import { localizeNoticeDateTimes } from '@kiao-dashboard-kit/date-time';
import { effortsForSelection } from '../flowNodeSettings';
import { useChatConversation } from './useChatConversation';
import type { SendOptions } from './useChatConversation';
import { useChatChainRuns } from './ChatChainRuns-ctx';
import type { ConversationRuntime } from './chatConversationReducer';
import { ChatMessageList } from './ChatMessageList';
import { ChatConversationDetails } from './ChatConversationDetails';
import { ChatBackgroundTasks } from './ChatBackgroundTasks';
import { ChatPermissionRequests } from './ChatPermissionRequests';
import { ChatQuestions } from './ChatQuestions';
import { ChatErrorNotice } from './ChatErrorNotice';
import { ChatResponseTokenLimit } from './ChatResponseTokenLimit';
import {
    ChatAttachButton, ChatAttachmentStrip, filesFromDrop, filesFromPaste, useChatAttachments,
} from './ChatAttachments';


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

    onRequestAgent?: (afterCreate: (conversation: HarnessConversation) => void) => void;

    canStart?: (harness: string) => Promise<boolean>;

    promptRef?: React.RefObject<HTMLTextAreaElement>;

    onFork: (source: HarnessConversation, messageId?: string, text?: string) => void;

    responseTokenLimit?: string;

    changeResponseTokenLimit: (id: string | null, limit: string | undefined) => void;
}

export const ChatConversationPane: React.FC<ChatConversationPaneProps> = ({
    paneKey, conversationId, conversation, currentPath, harnesses, optionsFor,
    restoredPrompt, onRequestAgent, canStart, promptRef, onFork, responseTokenLimit, changeResponseTokenLimit,
}) => {
    const {
        conversation: detail, messages, running, background, permissionRequests, questionRequests, lastError,
        notice: driverNotice,
        loading: transcriptLoading, send, sendBetween, sendFollowUp, clearQueue, queue, stop, decidePermission, answerQuestions,
    } = useChatConversation(conversationId);
    const { runs, stop: stopRun } = useChatChainRuns();
    const suspendedHere = useMemo(
        () => runs.find(candidate => candidate.state === 'suspended' && candidate.chat === conversationId),
        [runs, conversationId],
    );
    const [prompt, setPrompt] = useState('');
    const [overrides, setOverrides] = useState<{ id: string | null; options: SendOptions } | null>(null);
    const [authPending, setAuthPending] = useState(false);
    const [delivery, setDelivery] = useState<'steer' | 'followUp'>('steer');
    const files = useChatAttachments();
    const [dragOver, setDragOver] = useState(false);

    const harness = conversation?.harness ?? '';
    const harnessAvailable = harnesses.some(entry => entry.value === harness);
    const own = optionsFor(harness);
    const profile = own.profiles?.find(one => one.id === conversation?.profileId);
    const model = conversation?.model ?? '';
    const capabilities = profile?.models.find(one => one.value === model)?.capabilities ?? own.capabilities;
    const snapshot = conversation?.agentVersion;
    const needsAgent = !!conversation && (!(snapshot?.commit || snapshot?.draftId) || !harnessAvailable);
    const chosen = overrides?.id === conversationId ? overrides.options : undefined;
    const effort = chosen?.effort ?? conversation?.effort ?? '';
    const efforts = effortsForSelection(own, conversation ?? undefined, undefined, model);
    const effortOptions = effort && !efforts.some(option => option.value === effort)
        ? [...efforts, { value: effort, label: effort }]
        : efforts;

    const preferredMode = chosen?.permissionMode ?? conversation?.permissionMode ?? DEFAULT_PERMISSION_MODE;
    const offeredMode = own.permissionModes.find(mode => mode.value === preferredMode)
        ?? own.permissionModes.find(mode => mode.value === DEFAULT_PERMISSION_MODE)
        ?? own.permissionModes[0];
    const permissionMode = (offeredMode?.value ?? preferredMode) as HarnessPermissionMode;
    const permissionModeOptions = own.permissionModes.map(mode => ({
        value: mode.value as HarnessPermissionMode,
        label: PERMISSION_MODE_SHORT[mode.value] ?? mode.label,
    }));
    const thinking = chosen?.thinking ?? conversation?.thinking ?? true;
    const sendOptions: SendOptions = { effort: effort || undefined, thinking, permissionMode };

    useEffect(() => {
        setOverrides(null);
    }, [conversationId, conversation?.effort, conversation?.permissionMode, conversation?.thinking]);

    const changeTurnSettings = (patch: SendOptions) => {
        setOverrides(previous => ({
            id: conversationId,
            options: { ...(previous?.id === conversationId ? previous.options : {}), ...patch },
        }));
    };

    const boxPurpose = running
        ? 'Add to what the turn is doing…'
        : conversationId ? 'Continue the conversation…' : 'Write a message…';

    const sendHelp = running
        ? 'The running turn reads this at its next step, keeping its current settings.'
        : files.uploading ? 'Waiting for the attachments to finish uploading' : '';

    const [dismissedError, setDismissedError] = useState<ConversationRuntime['lastError']>(null);
    const notice = lastError === dismissedError ? null : lastError;

    // The transcript follows the newest message only for a reader who is at the bottom of it — see useStickToBottom.
    const stick = useStickToBottom(messages);
    const ownTextareaRef = useRef<HTMLTextAreaElement>(null);
    const textareaRef = promptRef ?? ownTextareaRef;

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
    const canCompose = running || (conversationId ? !!conversation && !needsAgent : !!onRequestAgent);
    const canSend = !authPending && canCompose && (running
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


    const checkingAuth = useRef(false);
    const sendTarget = useRef('');
    sendTarget.current = JSON.stringify([
        conversationId, harness, prompt, running, effort, permissionMode, thinking, responseTokenLimit, canCompose,
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
        const messageOptions = {
            attachments: files.ids,
            ...(responseTokenLimit && { responseTokenLimit }),
        };
        if (!conversationId) {
            onRequestAgent?.(created => {
                setPrompt('');
                files.clear();
                stick.follow();
                if (responseTokenLimit) {
                    changeResponseTokenLimit(created.id, responseTokenLimit);
                    changeResponseTokenLimit(null, undefined);
                }
                setPendingPrompt({ id: created.id, text, opts: messageOptions });
            });
            return;
        }
        setPrompt('');
        files.clear();
        stick.follow();
        const opts = { ...sendOptions, ...messageOptions };
        if (!suspendedHere) {
            send(text, opts);
            return;
        }
        const runId = suspendedHere.id;
        Modal.confirm({
            title: 'Carry on with the board?',
            content: 'Use this message as the task’s next turn and continue the chain after it succeeds.',
            okText: 'Yes, carry on',
            cancelText: 'No, this message only',
            onOk: () => send(text, { ...opts, resumeRunId: runId }),
            onCancel: () => { stopRun(runId); send(text, opts); },
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

            {/* Message history — the spinner only ever stands in for a transcript on its way ── */}
            {conversationId && transcriptLoading ? (
                <div className="chat-messages-loading"><Spin size="small" /></div>
            ) : (
                <ChatMessageList
                    messages={messages}
                    stick={stick}
                    folder={conversation?.folder ?? currentPath}
                    conversationId={conversationId}
                    intro={conversation && (
                        <ChatConversationDetails
                            key={conversation.id}
                            conversation={conversation}
                            detail={detail}
                            harnessOptions={own}
                        />
                    )}
                    onFork={conversation && !running
                        ? message => onFork(conversation, message.id, message.content)
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


            {needsAgent && !running && <Button size="small" onClick={() => onFork(conversation)}>
                Fork with an agent
            </Button>}

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
                    placeholder={`${boxPurpose} (Ctrl+Enter)`}
                    aria-label={running ? 'Message for the running turn' : 'Message for the agent'}
                    disabled={!canCompose}
                    rows={3}
                    style={promptHeight === null ? undefined : { height: promptHeight }}
                />

                <div className="chat-controls">
                    {profile && profile.status !== 'ready' && <span role="status">{profile.message || profile.status}</span>}
                    {running && capabilities?.followUp && <Select aria-label="Message delivery" size="small" value={delivery} onChange={setDelivery}
                        options={[{ value: 'steer', label: 'Steer now' }, { value: 'followUp', label: 'After current work' }]} />}
                    {canCompose && conversation && <>
                        {!running && capabilities?.compact && (
                            <Button size="small" disabled={!conversation.sessionId} onClick={() => send('/compact', sendOptions)}>
                                Compact
                            </Button>
                        )}
                        <Select
                            aria-label="Reasoning effort"
                            size="small"
                            placeholder="Effort"
                            value={effort || undefined}
                            onChange={effort => changeTurnSettings({ effort })}
                            options={effortOptions}
                            className="chat-effort-select"
                            classNames={{ popup: { root: 'chat-select-popup' } }}
                            popupMatchSelectWidth={false}
                            disabled={running || effortOptions.length === 0}
                        />
                        <Tooltip title={PERMISSION_MODE_HELP[permissionMode]}>
                            <Select<HarnessPermissionMode>
                                size="small"
                                value={permissionMode}
                                onChange={permissionMode => changeTurnSettings({ permissionMode })}
                                options={permissionModeOptions}
                                className={'chat-permission-select' + (permissionMode === 'bypassPermissions' ? ' chat-permission-select--bypass' : '')}
                                classNames={{ popup: { root: 'chat-select-popup' } }}
                                popupMatchSelectWidth={false}
                                disabled={running || permissionModeOptions.length === 0}
                                aria-label="Permission mode"
                            />
                        </Tooltip>
                        <IconButton
                            label="Toggle extended thinking"
                            tooltip={thinking ? 'Turn extended thinking off' : 'Turn extended thinking on'}
                            type={thinking ? 'primary' : 'default'}
                            icon={thinking ? <BulbFilled /> : <BulbOutlined />}
                            onClick={() => changeTurnSettings({ thinking: !thinking })}
                            disabled={running}
                            aria-pressed={thinking}
                        />
                    </>}
                    {canCompose && <ChatResponseTokenLimit
                        value={responseTokenLimit}
                        onChange={limit => changeResponseTokenLimit(conversationId, limit)}
                        disabled={running}
                    />}

                    <div className="chat-buttons">

                        <ChatAttachButton onFiles={takeFiles} disabled={running || !canCompose} />
                        <VoiceInputButton value={prompt} onChange={setPrompt} disabled={!canCompose} />

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
                                aria-label="Send"
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
        </div>
    );
};
