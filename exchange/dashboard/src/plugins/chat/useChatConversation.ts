// ── One conversation, as the panel sees it ────────────────────────────────────
//
// The chat is two halves joined here. Everything that has finished is on the server and comes from
// `GET /hybridflow-runner/conversations/{id}`; only the turn that is running comes over the socket. Neither
// half holds the other's messages, which is what keeps a reload, a second tab and a navigation from
// producing three different versions of the same conversation.
//
// The join is the delicate part: when a turn ends, its reply exists in both halves for as long as it
// takes to re-read the transcript. `clearSettledTurn` is what hands it over — called in the same
// tick the transcript arrives, so React batches the two updates and no render shows the reply twice.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
    AgentConversation,
    AgentConversationDetail,
    AgentPermissionMode,
    AgentTranscriptMessage,
} from 'kiao-worker';
import { useWorkerClient } from '@cms-core';
import type { BackgroundTask, ChatMessage, PermissionRequest, QuestionRequest } from './chatMessages';
import { summariseTool, toMessageBlock } from './chatConversationReducer';
import type { ConversationRuntime } from './chatConversationReducer';
import { useChatSocketContext } from './ChatSocket-ctx';

export interface SendOptions {
    model: string;
    effort: string;
    /** Extended thinking for this turn. */
    thinking: boolean;
    /** Whether this turn asks before each tool call, or skips every check. */
    permissionMode: AgentPermissionMode;
    /**
     * Ids of files already uploaded for this turn, in the order the user attached them. Unlike the
     * four above this is not a setting the conversation keeps: an attachment belongs to the one
     * message it was attached to, and the next prompt starts with none.
     */
    attachments?: string[];
}

export interface ChatConversationView {
    conversation: AgentConversation | null;
    /** The settled transcript, plus the live turn's bubbles while one is in flight. */
    messages: ChatMessage[];
    running: boolean;
    /**
     * The live (or last) turn's background work, whole: every workflow, delegation and
     * backgrounded tool call it handed off, finished ones kept. Empty where the turn handed
     * nothing off, or runs on an agent that tracks none.
     */
    background: BackgroundTask[];
    /**
     * Tool calls waiting for the user's answer. Non-empty only in the two manual modes, where the
     * turn makes no further progress until each is decided.
     */
    permissionRequests: PermissionRequest[];
    /**
     * What the turn has asked the user, waiting for an answer. Unlike the permission requests above
     * these appear in every mode — bypass included, since a mode about which tool calls may run has
     * no opinion about what the user thinks — and nothing but the user ever answers one.
     */
    questionRequests: QuestionRequest[];
    /** Why the last turn was refused or failed. The UI branches on `code`, never on the text. */
    lastError: ConversationRuntime['lastError'];
    /** The driver's latest remark about the live turn, if it has made one. Ephemeral by design. */
    notice: ConversationRuntime['notice'];
    loading: boolean;
    send: (promptText: string, opts: SendOptions) => void;
    /**
     * Says something into the turn that is already running, without starting one. Legal only while
     * `running` — the service refuses it otherwise with `no_running_turn` and hands the text back —
     * and it carries no settings and no attachments: the turn's were fixed when it began.
     */
    sendBetween: (text: string) => void;
    stop: () => void;
    decidePermission: (requestId: string, behavior: 'allow' | 'deny', message?: string) => void;
    /**
     * Sends the answers to one question ask — one entry per question, in the order they were asked,
     * blank for a question left unanswered. All blank is a dismissal: the model is told it was not
     * answered, which is the truth and is better information than a made-up answer.
     */
    answerQuestions: (requestId: string, answers: string[]) => void;
}

/** Stable empty arrays, so a conversation with nothing pending does not re-render its readers. */
const NO_REQUESTS: PermissionRequest[] = [];
const NO_QUESTIONS: QuestionRequest[] = [];
const NO_MESSAGES: ChatMessage[] = [];
const NO_BACKGROUND: BackgroundTask[] = [];

/**
 * Delays before re-reading a transcript the hand-over needs and did not get, in order, holding at
 * the last — the socket's own backoff. Giving up instead leaves the finished turn on the runtime
 * with no record of it anywhere else, which is the one state the two halves cannot recover from on
 * their own.
 */
const HANDOVER_RETRY_MS = [500, 1000, 2000, 4000, 8000, 15000];

/**
 * One transcript record as a bubble. A record that was written with `blocks` renders as the reply in
 * order; one written before blocks existed has only `text` and `tools`, and renders as it always did
 * — the order it happened in was never captured, and inventing one would assert something untrue
 * about a conversation the user can still read.
 */
const toChatMessage = (record: AgentTranscriptMessage): ChatMessage => ({
    id: record.id,
    role: record.role,
    content: record.text,
    between: record.between,
    blocks: record.blocks?.map(toMessageBlock),
    attachments: record.attachments,
    toolUses: record.blocks
        ? undefined
        : record.tools?.map(tool => ({ name: tool.name, summary: summariseTool(tool.name, tool.input) })),
    interrupted: record.interrupted,
    truncated: record.truncated,
});

export const useChatConversation = (conversationId: string | null): ChatConversationView => {
    const workerClient = useWorkerClient();
    const { runtimes, open, clearSettledTurn, send: sendFrame } = useChatSocketContext();
    const [detail, setDetail] = useState<AgentConversationDetail | null>(null);
    // True from the first render a conversation is shown in, not from the effect that reads it: a
    // chat with nothing in it yet is a spinner's job, and one render of an empty transcript reads as
    // a conversation that has none.
    const [loading, setLoading] = useState(conversationId !== null);
    // How many times the hand-over read below has been retried. State rather than a ref: the retry
    // is what re-runs that effect.
    const [handoverAttempt, setHandoverAttempt] = useState(0);

    const runtime = conversationId ? runtimes[conversationId] ?? null : null;

    // The transcript belongs to the conversation it was read for. Blanking it in an effect leaves
    // one render holding the previous conversation's messages under this one's live turn — visibly
    // two chats at once — so it is re-seeded during the render that changes conversation, the
    // "adjust state while rendering" pattern `useFileViewState` uses for the same reason.
    const [seededId, setSeededId] = useState(conversationId);
    if (seededId !== conversationId) {
        setSeededId(conversationId);
        setDetail(null);
        setLoading(conversationId !== null);
        setHandoverAttempt(0);
    }

    useEffect(() => {
        // Watching is never given up here: a conversation the user switched away from must keep
        // accumulating, which is exactly what the app-level provider is for.
        if (conversationId) open(conversationId);
    }, [conversationId, open]);

    const readTranscript = useCallback(async (id: string): Promise<AgentConversationDetail | null> => {
        try {
            return await workerClient.getAgentConversation(id);
        } catch {
            // Leaves what is already on screen. A transcript that failed to load is no reason to
            // blank a conversation the user is in the middle of.
            return null;
        }
    }, [workerClient]);

    useEffect(() => {
        if (!conversationId) return;
        let cancelled = false;
        setLoading(true);
        readTranscript(conversationId).then(next => {
            if (cancelled) return;
            if (next) setDetail(next);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [conversationId, readTranscript]);

    // The live turn's id. It changes when a process starts, and the service records the user's
    // prompt before it spawns one — so the moment this changes, the transcript holds what was asked.
    // Re-reading it is what lets a tab that did not send show the right prompt: `start` carries no
    // text at all, and the runtime's copy is whatever that tab last sent itself.
    const liveTurnId = runtime?.turnId ?? null;

    // The id of a turn that has ended and has not been re-read yet — `''` when the last prompt was
    // refused, since a refusal that names no turn takes the epoch with it. Null the rest of the
    // time, which is what keeps this from firing on every streamed frame.
    const settledTurnId = runtime && !runtime.running && !runtime.settled && (runtime.turnId || runtime.lastError)
        ? runtime.turnId ?? ''
        : null;

    // The live turn the transcript has already been read for, as `conversationId|turnId` — turn ids
    // are the service's to mint and mean nothing outside their conversation. Claimed only once a
    // read has landed, so one that failed or was cancelled mid-flight is taken again.
    const readTurn = useRef<string | null>(null);

    // One read for both turn boundaries. They are the same GET of the same transcript, and a reload
    // crosses them in a single state update — the `sync` answering the subscribe brings a turn that
    // is new to this tab and already finished — so reading them apart means asking twice for what
    // one answer holds. What is read for is a boundary being *reached*: this effect also re-runs
    // when one is left behind, the hand-over landing taking `settledTurnId` back to null, and that
    // asks for nothing.
    useEffect(() => {
        if (!conversationId) return;
        const liveTurnKey = liveTurnId && `${conversationId}|${liveTurnId}`;
        const forLiveTurn = !!liveTurnKey && readTurn.current !== liveTurnKey;
        if (!forLiveTurn && settledTurnId === null) return;
        let cancelled = false;
        let retry: ReturnType<typeof setTimeout> | undefined;
        readTranscript(conversationId).then(next => {
            if (cancelled) return;
            if (!next) {
                // The hand-over happens only against a transcript that actually arrived: marking the
                // turn settled after a failed read would drop the reply from the runtime without
                // anything else holding it. So it is asked again — the reply is on the runtime and
                // nowhere else until this succeeds. A read for a turn that merely started is not
                // retried: nothing is waiting on it, and what is on screen stays as it is.
                if (settledTurnId !== null) {
                    retry = setTimeout(
                        () => setHandoverAttempt(attempt => attempt + 1),
                        HANDOVER_RETRY_MS[Math.min(handoverAttempt, HANDOVER_RETRY_MS.length - 1)],
                    );
                }
                return;
            }
            if (liveTurnKey) readTurn.current = liveTurnKey;
            setDetail(next);
            // No turn id means the prompt never reached a process — a refusal writes no transcript
            // record, so there is nothing to hand over, and the refused prompt stays on screen next
            // to the reason it was refused instead of vanishing.
            if (settledTurnId) clearSettledTurn(conversationId, settledTurnId);
            // The ladder is per outage, not per conversation: leaving it where the last one ended
            // makes the next failure wait the maximum straight away, when the service being reachable
            // again is precisely what this read has just shown.
            setHandoverAttempt(0);
        });
        return () => { cancelled = true; clearTimeout(retry); };
    }, [conversationId, liveTurnId, settledTurnId, handoverAttempt, readTranscript, clearSettledTurn]);

    const messages = useMemo(() => {
        const settled = detail?.messages.map(toChatMessage) ?? NO_MESSAGES;
        if (!runtime) return settled;

        const live: ChatMessage[] = [];
        // A prompt of this tab's that nothing is coming for — refused, or queued behind a socket
        // that is down. Marked wherever it is rendered from below, because the bubble is otherwise
        // the same bubble a delivered message gets, and it is the only thing on screen that would
        // say it was sent.
        const unsent = runtime.pendingText && !runtime.running && !runtime.awaitingStart
            ? runtime.pendingText
            : '';
        // A transcript ends with a user message exactly while a turn is in flight, since the reply's
        // record is written when the turn settles. That tail *is* the prompt that turn is running on
        // — which is what both bubbles below have to be told apart from.
        const tail = settled[settled.length - 1];
        // How many of the live turn's betweens the transcript already holds. The service records one
        // the moment it is said, so a transcript read *after* it — which is what switching away from
        // a conversation and back does — comes back with it, while the runtime is still holding it
        // too. The trailing run is exactly the overlap: a settled turn always ends on its reply, so
        // betweens at the end of a transcript can only belong to the turn that is still running.
        let recordedBetweens = 0;
        while (recordedBetweens < settled.length
            && settled[settled.length - 1 - recordedBetweens].between) recordedBetweens += 1;
        // The live turn is what the transcript does not hold yet: the prompt that was sent, and the
        // reply as it streams. A turn already handed over to the transcript is not that, and neither
        // is one that reached this tab already finished — the service records a turn before it stops
        // calling it running, so a `sync` for a finished turn describes something REST is holding a
        // copy of. Rendering either would show the same exchange twice.
        //
        // Both of those are claims about the turn at `turnId`, and a prompt just sent has none yet:
        // the epoch stays on the previous turn until the server mints the new one. `awaitingStart`
        // is what says the runtime is holding this tab's own prompt rather than that turn's, and
        // that is the one case the flags do not speak for.
        if (runtime.awaitingStart || (!runtime.settled && !runtime.arrivedFinished)) {
            // The runtime's copy of the prompt is only wanted before the transcript's exists: between
            // hitting send and the process starting, and after a refusal that never wrote one.
            if (runtime.userText && tail?.role !== 'user') {
                live.push({
                    id: 'live-user',
                    role: 'user',
                    content: runtime.userText,
                    pending: runtime.userText === unsent,
                });
            }
            // Above the reply rather than below it. The reply is one bubble for the whole turn, so
            // there is no point *inside* it to file them at — and this is the order the transcript
            // reads them back in when the turn settles, so nothing on screen rearranges itself at
            // the end of a turn.
            runtime.betweens.slice(recordedBetweens).forEach((text, i) => live.push({
                id: `live-between-${recordedBetweens + i}`,
                role: 'user',
                content: text,
                between: true,
            }));
            if (runtime.running || runtime.blocks.length) {
                live.push({
                    id: 'live-assistant',
                    role: 'assistant',
                    content: '',
                    blocks: runtime.blocks,
                    isStreaming: runtime.running,
                });
            }
        }
        // The prompt this tab sent that no turn of its own came of. Nothing else can show it — a
        // refusal writes no transcript record, and a `sync` describes the conversation's own turn
        // rather than what this tab asked for — so it stays up, next to the reason it was refused,
        // until it is sent again or given up on. It is skipped while it is already on screen as the
        // live turn's prompt, which is what it is between hitting send and the `start` that answers.
        //
        // And skipped, too, when the transcript ends on it: a user record with no reply after it is
        // a prompt a turn is running on right now, so the service took this one after all and the
        // news of it is what went missing.
        const alreadyShown = (bubble: ChatMessage) =>
            bubble.role === 'user' && bubble.content === runtime.pendingText;
        if (runtime.pendingText && !live.some(alreadyShown) && !(tail && alreadyShown(tail))) {
            live.push({
                id: 'pending-user',
                role: 'user',
                content: runtime.pendingText,
                pending: runtime.pendingText === unsent,
            });
        }
        return live.length ? [...settled, ...live] : settled;
    }, [detail, runtime]);

    const send = useCallback((promptText: string, opts: SendOptions) => {
        const prompt = promptText.trim();
        // A message of attachments and no words is a message: "what is this?" is what dropping a
        // screenshot into a chat says, and the service appends the note naming the files either
        // way, so what reaches the CLI is never empty.
        if (!conversationId || (!prompt && !opts.attachments?.length)) return;
        sendFrame({ type: 'prompt', conversationId, prompt, ...opts });
    }, [conversationId, sendFrame]);

    const sendBetween = useCallback((text: string) => {
        const between = text.trim();
        // Nothing optimistic and nothing local: the service records the message and echoes it to
        // every tab watching the turn, so the bubble comes from the same place a second tab's does.
        if (!conversationId || !between) return;
        sendFrame({ type: 'between', conversationId, text: between });
    }, [conversationId, sendFrame]);

    const stop = useCallback(() => {
        if (!conversationId) return;
        // Nothing is settled here: the turn ends on `stopped`, and its transcript record is written
        // before that frame leaves the server. Guessing the outcome locally is what would make the
        // two halves disagree.
        sendFrame({ type: 'stop', conversationId });
    }, [conversationId, sendFrame]);

    const decidePermission = useCallback((requestId: string, behavior: 'allow' | 'deny', message?: string) => {
        if (!conversationId) return;
        // The card goes when `permission_resolved` comes back, not now — that frame is also what a
        // second tab watching the same turn gets, so both drop the card for the same reason.
        sendFrame({ type: 'permission_decision', conversationId, requestId, behavior, message });
    }, [conversationId, sendFrame]);

    const answerQuestions = useCallback((requestId: string, answers: string[]) => {
        if (!conversationId) return;
        // Same as a decision: the card is taken off screen by `permission_resolved`, which is what
        // also settles it in the other tab watching the same turn.
        sendFrame({ type: 'question_answer', conversationId, requestId, answers });
    }, [conversationId, sendFrame]);

    return useMemo(() => ({
        conversation: detail,
        messages,
        running: runtime?.running ?? false,
        background: runtime?.background ?? NO_BACKGROUND,
        permissionRequests: runtime?.permissionRequests ?? NO_REQUESTS,
        questionRequests: runtime?.questionRequests ?? NO_QUESTIONS,
        lastError: runtime?.lastError ?? null,
        notice: runtime?.notice ?? null,
        loading,
        send,
        sendBetween,
        stop,
        decidePermission,
        answerQuestions,
    }), [detail, messages, runtime, loading, send, sendBetween, stop, decidePermission, answerQuestions]);
};
