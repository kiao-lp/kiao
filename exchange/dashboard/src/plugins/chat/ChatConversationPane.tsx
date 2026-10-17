// ── One chat ──────────────────────────────────────────────────────────────────
//
// Everything below the switcher for a single conversation: its transcript, the cards a parked turn
// is waiting on, and the box a prompt is typed into with the settings the next turn runs with.
//
// It is a component rather than the body of the panel because the panel shows several at once — a
// pinned conversation gets a column of its own. So everything a chat holds while it is being used
// is per-pane: the draft in the box, the model and mode selects, the expanded editor. What is one
// per panel — the socket, the conversation registry, the option lists — is read once above and
// handed down, so four columns do not make four copies of the same request.
//
// `conversationId` is null in one case only: the main column with nothing selected. A prompt typed
// there makes the conversation first, which is why this pane is the only one given `onCreate`.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Select, Button, Spin, Modal, message } from 'antd';
import { SendOutlined, StopOutlined, ExpandAltOutlined, BulbOutlined, BulbFilled } from '@ant-design/icons';
import type {
    AgentConversation, AgentConversationCreate, AgentOptionsEntry, AgentPermissionMode,
} from 'kiao-worker';
import { markdownLinkDropHandlers, Tooltip } from '@cms-core';
import { MODEL_EFFORT_SEP, defaultModelEffortFor } from './chatDefaults';
import { useChatConversation } from './useChatConversation';
import type { SendOptions } from './useChatConversation';
import { useChatChainRuns } from './ChatChainRuns-ctx';
import type { ConversationRuntime } from './chatConversationReducer';
import { ChatMessageList } from './ChatMessageList';
import { ChatBackgroundTasks } from './ChatBackgroundTasks';
import { ChatPermissionRequests } from './ChatPermissionRequests';
import { ChatQuestions } from './ChatQuestions';
import { ChatErrorNotice } from './ChatErrorNotice';
import { useStickToBottom } from './useStickToBottom';
import {
    ChatAttachButton, ChatAttachmentStrip, filesFromDrop, filesFromPaste, useChatAttachments,
} from './ChatAttachments';

// A single merged "model:effort" value keeps model and effort in one select — see chatDefaults,
// which also picks the pair the toolbar shows until a conversation is selected.

// Asking before each tool call, and waiting for the answer, is the safest of the three modes, so it
// is where a fresh toolbar starts. The service defaults an *omitted* mode to `bypassPermissions`
// instead, to keep working for a client that predates the field — this UI always states its choice,
// so the two never disagree.
const DEFAULT_PERMISSION_MODE: AgentPermissionMode = 'manual';

// What each mode does, in the toolbar's tooltip. Keyed by wire value rather than branched on, so the
// mode a service offers that this build has no line for still selects and still runs — it simply
// goes untooltipped instead of being described as the mode it is not.
export const PERMISSION_MODE_HELP: Record<AgentPermissionMode, string> = {
    manual: 'Manual: every tool call the agent cannot run on its own is put to you first, and the turn '
        + 'waits for your answer',
    manualLive: 'Live: every tool call is put to you, but one unanswered after ten seconds '
        + 'is allowed. Answer in time and yours counts',
    bypassPermissions: 'Bypass: the agent runs every tool call without asking',
};

// The mode in one short word. The service spells them `Manual Live` and `Bypass permissions`, which
// is two words the toolbar has no room for — and `Manual` beside them reads as the odd one out. A
// mode this build has no word for keeps the service's label, so it still selects and still runs.
const PERMISSION_MODE_SHORT: Record<string, string> = {
    manual: 'Manual',
    manualLive: 'Live',
    bypassPermissions: 'Bypass',
};

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ── The message box's height ─────────────────────────────────────────────────
//
// The box is resized from a bar above it rather than from the corner grip a textarea comes with.
// The grip is a few pixels in the one corner the Send button crowds, and it only ever grows the box
// *downwards*: in a sidebar that is off the bottom of the panel. The bar spans the whole width and
// is dragged upwards, into the transcript, which is where the room actually is.
const MIN_PROMPT_HEIGHT = 58;
/** How far one arrow-key press moves the bar — a line or so of the box's own text. */
const PROMPT_HEIGHT_STEP = 24;
/**
 * What the box is never allowed to take from the column it is in: the controls row underneath it,
 * and a glimpse of the transcript above. Without it a box dragged past the column's own height
 * pushes its own toolbar out of the bottom of the panel.
 */
const PROMPT_HEIGHT_ROOM = 120;

/** The column that holds the list, as a pane key. Its conversation changes; the column does not. */
export const MAIN_PANE = 'main';

export interface ChatConversationPaneProps {
    /**
     * Which column this is — a pinned conversation's id, or {@link MAIN_PANE}. It names the pane
     * rather than what the pane is showing, which is what lets the panel hand something to the main
     * column in the same breath as telling it which conversation to show.
     */
    paneKey: string;
    /** The conversation this pane is on. `null` is the main column with nothing selected. */
    conversationId: string | null;
    /** The registry's copy of it — kept current in every tab by the `conversation` frames. */
    conversation: AgentConversation | null;
    /** The folder the browser is showing: where a prompt typed with nothing selected makes one. */
    currentPath: string;
    /** Every agent this deployment offers, the first being the default. */
    agents: AgentOptionsEntry[];
    /** What one of them offers — its models, its efforts, the permission modes it has. */
    optionsFor: (agent: string) => AgentOptionsEntry;
    /**
     * The prompt the transport last gave up on, offered to every pane at once: the one it is
     * addressed to takes it, the rest leave it alone. A new object per drop, so the same text
     * failing twice is two things to give back rather than one.
     */
    restoredPrompt: { paneKey: string; text: string; attachments: string[] } | null;
    /** Makes a conversation in `currentPath` and selects it. Only the main column ever calls it. */
    onCreate?: (body: AgentConversationCreate) => Promise<AgentConversation>;
    /** Handed in when the panel wants to put the caret here — what `+ New conversation` does. */
    promptRef?: React.RefObject<HTMLTextAreaElement>;
    /**
     * Where this toolbar publishes what it is showing, so a starter above the columns — which has
     * no toolbar of its own — makes a conversation on the settings the user can see. The agent goes
     * with them: the starter for this pane's engine takes the settings, and every other starter
     * takes its own defaults, since a model picked for one engine is no model on another.
     */
    settingsRef?: React.MutableRefObject<NewConversationSettings | null>;
    /**
     * Forks this conversation at one of its prompts: the copy holds everything above that prompt, and
     * the prompt's own text comes back to a box to be asked again. The panel owns it because a fork
     * is a second conversation and the panel is what shows conversations — see `ChatPrompt`.
     */
    onFork?: (conversationId: string, messageId: string, text: string) => void;
}

/**
 * What a starter makes a conversation with: everything the toolbar is showing, the agent included.
 * The agent is not part of {@link SendOptions} because a prompt can never change it — a conversation
 * is bound to its engine at creation — but it is what tells the starter its own settings from
 * another engine's.
 */
export type NewConversationSettings = SendOptions & { agent: string };

export const ChatConversationPane: React.FC<ChatConversationPaneProps> = ({
    paneKey, conversationId, conversation, currentPath, agents, optionsFor,
    restoredPrompt, onCreate, promptRef, settingsRef, onFork,
}) => {
    const {
        messages, running, background, permissionRequests, questionRequests, lastError,
        notice: driverNotice,
        loading: transcriptLoading, send, sendBetween, stop, decidePermission, answerQuestions,
    } = useChatConversation(conversationId);
    // The board's plays, for the one question this pane asks about them: a run stopped with *this*
    // conversation is picked back up — or dropped — by the next message said here. Several run at
    // once, so the one this pane is about is found by the chat it was playing in.
    const { runs, stop: stopRun, resume: resumeRun } = useChatChainRuns();
    const suspendedHere = useMemo(
        () => runs.find(candidate => candidate.state === 'suspended' && candidate.chat === conversationId),
        [runs, conversationId],
    );
    const [prompt, setPrompt] = useState('');
    const [modelEffort, setModelEffort] = useState('');
    const [thinking, setThinking] = useState(true);
    const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>(DEFAULT_PERMISSION_MODE);
    const [expandedModalOpen, setExpandedModalOpen] = useState(false);
    // Per-pane, like the draft in the box and for the same reason: a file attached in one column is
    // going with that column's next message and no other.
    const files = useChatAttachments();
    // Purely a highlight, so a drop lands somewhere the user can see they are dropping onto.
    const [dragOver, setDragOver] = useState(false);

    // The agent this pane is speaking to: the conversation's where there is one, and otherwise
    // the deployment's default. There is no control for it below — the starters above the columns
    // are where the engine is chosen, and a conversation keeps its agent for life.
    const agent = conversation?.agent || agents[0]?.value || '';
    const agentAvailable = agents.some(entry => entry.value === agent);
    // …and therefore the three lists, which are that agent's own: `opus` is a model on Claude and no
    // model at all on Codex, and Codex publishes one permission mode where Claude publishes three.
    const own = useMemo(() => optionsFor(agent), [optionsFor, agent]);
    const models = own.models;
    const efforts = own.efforts;
    const permissionModes = own.permissionModes;

    // Grouped options: one option group per model, each listing the available efforts. The value
    // encodes both halves as "model:effort".
    const modelEffortGroups = useMemo(() => models.map(m => ({
        label: m.label,
        title: m.label,
        options: efforts.map(e => ({
            value: `${m.value}${MODEL_EFFORT_SEP}${e.value}`,
            label: `${m.label} · ${e.label}`,
        })),
    })), [models, efforts]);

    // The service owns the list of modes; the client only shortens their names — see
    // `PERMISSION_MODE_SHORT`.
    const permissionModeOptions = useMemo(
        () => permissionModes.map(m => ({
            value: m.value as AgentPermissionMode,
            label: PERMISSION_MODE_SHORT[m.value] ?? m.label,
        })),
        [permissionModes],
    );

    // A mode the service no longer offers is swapped for one it does. It can only be
    // `bypassPermissions` on a deployment that withdrew it — gone from the option list, but still
    // stored on a conversation created before the withdrawal. Falling back keeps what the
    // toolbar shows and what a prompt would run in the same thing; the service refuses the withdrawn
    // mode either way, so the alternative is a refusal on every send until the user notices the box.
    useEffect(() => {
        if (!permissionModeOptions.length) return;
        if (permissionModeOptions.some(o => o.value === permissionMode)) return;
        const fallback = permissionModeOptions.find(o => o.value === DEFAULT_PERMISSION_MODE)
            ?? permissionModeOptions[0];
        setPermissionMode(fallback.value);
    }, [permissionModeOptions, permissionMode]);

    // The service's own pair for this agent where it has one — `opus` at `max` on Claude, the
    // newest Spark contributor build at `max` on Muse — and cheapest + lightest where it has not
    // (Codex). Used until a conversation is selected, and as the settings the next one is created
    // with.
    const defaultModelEffort = useMemo(() => {
        if (!models.length || !efforts.length) return '';
        const { model, effort } = defaultModelEffortFor(own);
        return `${model}${MODEL_EFFORT_SEP}${effort}`;
    }, [own]);

    // What the conversation stores. These are defaults a prompt may override, not a lock: the
    // toolbar shows them, changing one is legal at any time, and the turn that uses the new value
    // makes it the conversation's default in turn.
    const storedModelEffort = conversation
        ? `${conversation.model}${MODEL_EFFORT_SEP}${conversation.effort}`
        : '';
    const hasStoredModelEffort = Boolean(conversation?.model || conversation?.effort);
    const storedPermissionMode = conversation?.permissionMode;
    const storedThinking = conversation?.thinking;

    // Catalogue defaults fill a composer that has no stored model or effort. A conversation's
    // model may arrive before its agent's options or be absent from a stale catalogue; neither
    // changes what ran or what the next turn should use.
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
        // Keyed on the values and not on the record, so switching conversation adopts what it holds
        // while a record that came back unchanged leaves a choice the user has not sent yet alone.
    }, [storedModelEffort, storedPermissionMode, storedThinking]);

    const selectedModelEffort = modelEffort || storedModelEffort || defaultModelEffort;
    const [model, effort] = selectedModelEffort.split(MODEL_EFFORT_SEP);
    // Keep the selected pair readable even when the catalogue does not yet name it. Use the
    // stored ids for missing labels, and offer just that pair alongside the advertised choices.
    const modelEffortOptions = useMemo(() => {
        if (!model || !effort || modelEffortGroups.some(g => g.options.some(o => o.value === selectedModelEffort))) {
            return modelEffortGroups;
        }
        const modelIndex = models.findIndex(m => m.value === model);
        const modelLabel = models[modelIndex]?.label ?? model;
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

    // The box does two different things and says which in the one place a user is already looking.
    // While a turn runs it sends a *between* — folded into that turn at its next step, so it steers
    // the reply on screen rather than queueing behind it — and nothing else in the row makes that
    // visible: the Send button is the same button, in the same corner, in both states.
    const boxPurpose = running
        ? 'Add to what the turn is doing…'
        : conversationId ? 'Continue the conversation…' : 'Ask the agent…';
    const promptPlaceholder = `${boxPurpose} (Ctrl+Enter)`;

    // Why the box does what it does, for the reader who hovers rather than the one who reads the
    // placeholder. Nothing here is about the turn's settings: a between has none, which is the point.
    const sendHelp = running
        ? 'Sent into the running turn — the agent reads it at its next step and carries on, '
            + 'with the model, effort and mode it started with'
        : files.uploading ? 'Waiting for the attachments to finish uploading' : '';

    // Published rather than lifted: the selects are this column's, and a panel-wide copy of them
    // would be a second place for four values to be true in.
    useEffect(() => {
        if (settingsRef) settingsRef.current = { ...sendOptions, agent };
    });

    // A refusal is shown until it is waved away, and compared by identity rather than by code: the
    // reducer mints a new object for every `error` frame, so the same refusal happening again is a
    // notice of its own rather than one already dismissed.
    const [dismissedError, setDismissedError] = useState<ConversationRuntime['lastError']>(null);
    const notice = lastError === dismissedError ? null : lastError;

    // The transcript follows the newest message only for a reader who is at the bottom of it — see
    // useStickToBottom. Keyed on `messages`, which is the one thing that changes when there is
    // something new to follow.
    const stick = useStickToBottom(messages);
    const ownTextareaRef = useRef<HTMLTextAreaElement>(null);
    const textareaRef = promptRef ?? ownTextareaRef;
    const expandedTextareaRef = useRef<HTMLTextAreaElement>(null);

    // Null until the bar is first dragged, so an untouched box is the `rows` it was written with
    // rather than a number this file would have to keep in step with the CSS.
    const [promptHeight, setPromptHeight] = useState<number | null>(null);
    // Where the drag started, in the pointer's coordinates and in the box's. Held in a ref because
    // the moves that read it are not renders: only the height it computes is state.
    const dragFrom = useRef<{ pointerY: number; height: number } | null>(null);

    // The ceiling is the column's own height rather than the window's: a pinned chat is a column
    // among others and 70vh of box would be its whole panel. The window is the fallback for a pane
    // nothing has laid out yet, which is also every pane under jsdom.
    const maxPromptHeight = () => {
        const pane = textareaRef.current?.closest('.chat-pane')?.getBoundingClientRect().height ?? 0;
        const ceiling = pane > PROMPT_HEIGHT_ROOM ? pane - PROMPT_HEIGHT_ROOM : window.innerHeight * 0.7;
        return Math.round(Math.max(ceiling, MIN_PROMPT_HEIGHT));
    };

    const clampHeight = (height: number) => Math.min(Math.max(height, MIN_PROMPT_HEIGHT), maxPromptHeight());
    /** The height on screen, whether it was dragged to or is still the one `rows` gave. */
    const currentHeight = () => promptHeight
        || textareaRef.current?.getBoundingClientRect().height
        || MIN_PROMPT_HEIGHT;

    const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
        // Captured on the bar, so a pointer that runs off it — or off the panel — keeps resizing
        // until it is let go, instead of dropping the drag halfway. Called defensively: the drag
        // works without capture, and jsdom has no capture at all.
        e.currentTarget.setPointerCapture?.(e.pointerId);
        dragFrom.current = { pointerY: e.clientY, height: currentHeight() };
        // Otherwise the drag selects the transcript it is dragged across.
        e.preventDefault();
    };

    const onResize = (e: React.PointerEvent<HTMLDivElement>) => {
        const from = dragFrom.current;
        if (!from) return;
        // Up is taller: the bar is the box's top edge, and it goes where the pointer went.
        setPromptHeight(clampHeight(from.height + (from.pointerY - e.clientY)));
    };

    const endResize = (e: React.PointerEvent<HTMLDivElement>) => {
        dragFrom.current = null;
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    };

    // The bar is a control and not just a texture, so it answers the arrow keys too — a pointer
    // drag is not the only way to reach a separator.
    const resizeByKey = (e: React.KeyboardEvent) => {
        const step = e.key === 'ArrowUp' ? PROMPT_HEIGHT_STEP : e.key === 'ArrowDown' ? -PROMPT_HEIGHT_STEP : 0;
        if (!step) return;
        e.preventDefault();
        setPromptHeight(clampHeight(currentHeight() + step));
    };

    // The text of a prompt that never left goes back in front of what is being typed now rather than
    // replacing it: neither is this pane's to throw away. Taken once per drop, since the effect that
    // takes it runs twice under StrictMode and the user's text would come back doubled.
    const takenDrop = useRef<ChatConversationPaneProps['restoredPrompt']>(null);
    useEffect(() => {
        if (!restoredPrompt || restoredPrompt.paneKey !== paneKey) return;
        if (takenDrop.current === restoredPrompt) return;
        takenDrop.current = restoredPrompt;
        setPrompt(current => (current ? `${restoredPrompt.text}\n\n${current}` : restoredPrompt.text));
        // The files are still on the server; only the chips naming them were let go when the box
        // sent. Without this the second attempt goes without the screenshot the first was about.
        files.restore(restoredPrompt.attachments);
    }, [restoredPrompt, paneKey, files.restore]);

    // A prompt typed with no conversation selected makes one first. It is held here rather than sent
    // from the click, because `send` is bound to the conversation this render was made for — sending
    // in the same tick would send to the previous one, or to nothing at all.
    const [pendingPrompt, setPendingPrompt] = useState<{ id: string; text: string; opts: SendOptions } | null>(null);

    useEffect(() => {
        if (!pendingPrompt || pendingPrompt.id !== conversationId) return;
        setPendingPrompt(null);
        send(pendingPrompt.text, pendingPrompt.opts);
    }, [pendingPrompt, conversationId, send]);

    // Nothing to send, or nothing that can be sent yet. An upload still in flight has no id for the
    // prompt to name, so the message waits for it rather than going without the file.
    //
    // While a turn runs the box sends a *between* instead, and a between carries no attachments: the
    // running turn was handed its files when it started, and there is no second message for a new one
    // to belong to. So words are what it takes — the chips stay disabled, as they already were.
    const canSend = agentAvailable && (running
        ? !!prompt.trim()
        : (!!prompt.trim() || files.ids.length > 0) && !files.uploading);

    // A between the service refused reached nobody, so the text is the user's again. It goes back in
    // the box rather than being dropped, and the turn is over by definition — pressing Send once more
    // starts one of its own, which is what the refusal says. Held in a ref because the box is emptied
    // when it sends and this is the only copy left.
    const sentBetween = useRef<string | null>(null);
    useEffect(() => {
        const text = sentBetween.current;
        if (!text || lastError?.code !== 'no_running_turn') return;
        sentBetween.current = null;
        setPrompt(current => (current ? `${text}\n\n${current}` : text));
    }, [lastError]);

    /**
     * Asks whether a board's play is picked back up along with this conversation.
     *
     * Stopping a turn stops the run it belonged to — that is what interrupting it says — and the run
     * is kept where it stopped, in this chat. So the plainest way of carrying on is the one the user
     * is already taking: saying something here. The question is put once, at the moment it becomes a
     * decision, and it is a genuine question — the message may be a correction that has nothing to do
     * with the board, in which case *No* drops the run and this is an ordinary chat again.
     *
     * Either answer is settled before the message goes out: the run attaches to the turn about to
     * start, so it has to be told which it is first.
     */
    const askAboutTheRun = (): Promise<void> | null => {
        // Null rather than a resolved promise: an ordinary message must not wait a tick on a question
        // nobody is being asked.
        if (!conversationId || !suspendedHere) return null;
        const runId = suspendedHere.id;
        return new Promise<void>(resolve => Modal.confirm({
            title: 'Carry on with the board?',
            content: 'The board’s play stopped with this conversation. Sending this message can pick '
                + 'it back up: what the agent answers is filed under the flow node that was playing, and the '
                + 'chain carries on from there.',
            okText: 'Yes, carry on',
            cancelText: 'No, this message only',
            onOk: () => resumeRun(runId).finally(resolve),
            // Answering *no* drops the run: the question is put once, at the moment it is a decision,
            // and a board that asked it again on every message would be asking to be ignored.
            onCancel: () => { stopRun(runId); resolve(); },
        }));
    };

    const doSend = () => {
        const text = prompt.trim();
        if (!canSend) return;
        // Into the turn that is running, rather than starting one. No settings ride along — the turn
        // was spawned with its own and they cannot be changed under it — and nothing is cleared but
        // the box: the reply on screen is the one this message is about.
        if (running) {
            setPrompt('');
            stick.follow();
            sentBetween.current = text;
            sendBetween(text);
            return;
        }
        const opts: SendOptions = { ...sendOptions, attachments: files.ids };
        setPrompt('');
        // Back to the bottom, whatever the user had scrolled back to read: they are adding to the end
        // of the conversation, and the reply they asked for is only visible from there.
        stick.follow();
        if (conversationId) {
            files.clear();
            // The board's question first, where there is one to ask: a run picked back up attaches to
            // the turn this message starts, so it has to be told before the message goes.
            const asked = askAboutTheRun();
            if (asked) void asked.then(() => send(text, opts));
            else send(text, opts);
            return;
        }
        // Only the main column can be here, and it is the one pane given `onCreate`.
        onCreate?.({ folder: currentPath, agent, model, effort, permissionMode, thinking })
            .then(created => {
                // Let go of the chips only once the conversation exists. Clearing them with the box
                // would strand the ids: the files are on the server, and nothing left on screen
                // would know their names.
                files.clear();
                setPendingPrompt({ id: created.id, text, opts });
            })
            .catch(e => {
                // The text goes back in the box: it is the user's, and a create that failed is
                // answered by fixing what it named and sending again. The attachments were never
                // taken off it, so they go with the second attempt.
                setPrompt(text);
                message.error(`Could not create a conversation: ${errorText(e)}`);
            });
    };

    // Files arriving from a paste, a drop or the picker. What was refused is said out loud: a drop
    // of twelve files that silently attached ten is how a user ends up asking about a screenshot
    // that was never sent.
    const takeFiles = (incoming: File[]) => {
        if (!incoming.length) return;
        files.add(incoming).forEach(refusal => message.warning(`Not attached: ${refusal}`));
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        const pasted = filesFromPaste(e.clipboardData);
        if (!pasted.length) return;
        // Only when this is a paste of files and not of text — see filesFromPaste. Otherwise the
        // default runs and the paste is the ordinary one it has always been.
        e.preventDefault();
        takeFiles(pasted);
    };

    // A file dragged in from the file tree is not an attachment but a **link** to a file the CLI
    // can already open where it stands, so the box takes it as markdown rather than as an upload:
    // an attachment is a copy sent along, and a store path is the file itself. The two never meet —
    // an attachment drop carries `Files`, and this one carries the store's own paths.
    const linkDrop = markdownLinkDropHandlers(prompt, setPrompt);

    const handleDrop = (e: React.DragEvent) => {
        const dropped = filesFromDrop(e.dataTransfer);
        setDragOver(false);
        if (!dropped.length) return;
        e.preventDefault();
        takeFiles(dropped);
    };

    // Both are needed for a drop to fire at all: without preventDefault on dragover the browser
    // navigates to the file instead, which loses whatever was typed in the box.
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
            {/* Shown only while something is being dragged over the column, so the drop has a
                visible target rather than being a thing the user has to already know about. */}
            {dragOver && (
                <div className="chat-drop-overlay">Drop to attach to your next message</div>
            )}

            {/* ── Message history — the spinner only ever stands in for a transcript on its way ── */}
            {conversationId && transcriptLoading ? (
                <div className="chat-messages-loading"><Spin size="small" /></div>
            ) : (
                <ChatMessageList
                    messages={messages}
                    stick={stick}
                    folder={conversation?.folder ?? currentPath}
                    conversationId={conversationId}
                    // Not while a turn is running: the service refuses to fork a conversation it is
                    // still writing — the reply would land in one of the two and not the other — so
                    // the action is withheld rather than offered and then refused.
                    onFork={onFork && conversationId && !running
                        ? message => onFork(conversationId, message.id, message.content)
                        : undefined}
                />
            )}

            {/* ── Pending permission requests — the turn is parked until these are answered, or,
                   in Manual Live, until the service's own count runs out and allows them ── */}
            <ChatPermissionRequests requests={permissionRequests} onDecide={decidePermission} />

            {/* ── What the turn is asking the user — it is parked until this is answered or
                   dismissed, in every permission mode, and nothing ever answers it on their behalf ── */}
            <ChatQuestions requests={questionRequests} onAnswer={answerQuestions} />

            {/* ── Everything else the service refused, which has nowhere else to be said ── */}
            <ChatErrorNotice error={notice} onDismiss={() => setDismissedError(lastError)} />

            {/* ── The turn's background work — what it handed off and where each stands.
                   The counts first, then the rows: a wait with a breakdown instead of a wait
                   with a sentence. Rendered while the turn runs and after it settled; nothing
                   at all where the turn handed nothing off. ── */}
            <ChatBackgroundTasks tasks={background} />

            {/* ── The driver's own remark about the live turn — a silence naming itself. Shown
                   while the turn it is about runs, and gone with it: it was never written
                   anywhere. ── */}
            {running && driverNotice && (
                <div className="chat-driver-notice" role="status">
                    <Spin size="small" />
                    <span className="chat-driver-notice-text">{driverNotice}</span>
                </div>
            )}

            {/* ── Input area ── */}
            <div className="chat-input-area">
                {/* The box's top edge, dragged up to make it taller */}
                <Tooltip title="Drag up to make the message box taller">
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
                </Tooltip>
                {/* What is going with the next message, above the box that is typing it */}
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
                    aria-label={running ? 'Message for the running turn' : 'Message for the agent'}
                    rows={3}
                    style={promptHeight === null ? undefined : { height: promptHeight }}
                />

                <div className="chat-controls">
                    {/* Model + effort in one select. Per-turn, and kept as the conversation's default
                        — the running turn is the only thing they cannot be changed under. */}
                    <Tooltip title="Model and effort — used for the next turn, and kept as this conversation's default">
                        <Select
                            size="small"
                            value={selectedModelEffort}
                            onChange={setModelEffort}
                            options={modelEffortOptions}
                            className="chat-model-effort-select"
                            classNames={{ popup: { root: 'chat-select-popup' } }}
                            popupMatchSelectWidth={false}
                            disabled={running || !agentAvailable}
                        />
                    </Tooltip>

                    {/* Permission mode — per-turn, and the one control that changes what the agent
                        may do on its own, so bypass is marked as the risky choice it is */}
                    <Tooltip title={PERMISSION_MODE_HELP[permissionMode]}>
                        <Select<AgentPermissionMode>
                            size="small"
                            value={permissionMode}
                            onChange={setPermissionMode}
                            options={permissionModeOptions}
                            className={`chat-permission-select${permissionMode === 'bypassPermissions' ? ' chat-permission-select--bypass' : ''}`}
                            classNames={{ popup: { root: 'chat-select-popup' } }}
                            popupMatchSelectWidth={false}
                            disabled={running || !agentAvailable}
                            aria-label="Permission mode"
                        />
                    </Tooltip>

                    {/* Extended thinking — a per-turn switchable icon */}
                    <Tooltip title={thinking ? 'Extended thinking: on (click to turn off)' : 'Extended thinking: off (click to turn on)'}>
                        <Button
                            size="small"
                            type={thinking ? 'primary' : 'default'}
                            icon={thinking ? <BulbFilled /> : <BulbOutlined />}
                            onClick={() => setThinking(t => !t)}
                            disabled={running || !agentAvailable}
                            aria-pressed={thinking}
                            aria-label="Toggle extended thinking"
                        />
                    </Tooltip>

                    <div className="chat-buttons">
                        {/* A between carries no attachments — the running turn was handed its files
                            when it started, and there is no second message for a new one to belong
                            to — so this is the one control the turn still takes away. */}
                        <ChatAttachButton onFiles={takeFiles} disabled={running || !agentAvailable} />
                        <Tooltip title="Open in large editor">
                            <Button
                                size="small"
                                icon={<ExpandAltOutlined />}
                                onClick={() => setExpandedModalOpen(true)}
                            />
                        </Tooltip>
                        {/* Stop *and* Send while a turn runs: the two are different answers to a turn
                            going the wrong way, and the useful one is usually to say so rather than
                            to kill it. Send keeps its corner in both states so it does not move
                            under the pointer when a turn starts. */}
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
