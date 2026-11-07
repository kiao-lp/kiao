// `GET /hybridflow-runner/conversations/{id}`; only the turn that is running comes over the socket.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
    AgentQueuedMessage,
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
    thinking: boolean;

    permissionMode: AgentPermissionMode;

    attachments?: string[];
}

export interface ChatConversationView {
    queue: AgentQueuedMessage[];
    sendFollowUp: (text: string) => void;
    clearQueue: () => void;
    conversation: AgentConversation | null;

    messages: ChatMessage[];
    running: boolean;

    background: BackgroundTask[];

    permissionRequests: PermissionRequest[];

    questionRequests: QuestionRequest[];

    lastError: ConversationRuntime['lastError'];

    notice: ConversationRuntime['notice'];
    loading: boolean;
    send: (promptText: string, opts: SendOptions) => void;
    /** Says something into the turn that is already running, without starting one. */
    sendBetween: (text: string) => void;
    stop: () => void;
    decidePermission: (requestId: string, behavior: 'allow' | 'deny', message?: string) => void;

    answerQuestions: (requestId: string, answers: string[]) => void;
}

/** Stable empty arrays, so a conversation with nothing pending does not re-render its readers. */
const NO_REQUESTS: PermissionRequest[] = [];
const NO_QUESTIONS: QuestionRequest[] = [];
const NO_MESSAGES: ChatMessage[] = [];
const NO_BACKGROUND: BackgroundTask[] = [];

/** Delays before re-reading a transcript the hand-over needs and did not get, in order, holding at. */
const HANDOVER_RETRY_MS = [500, 1000, 2000, 4000, 8000, 15000];

/** One transcript record as a bubble. */
const toChatMessage = (record: AgentTranscriptMessage): ChatMessage => ({
    id: record.id,
    role: record.role,
    content: record.text,
    between: record.between,
    blocks: record.blocks?.map(toMessageBlock),
    attachments: record.attachments,
    queue: record.queue,
    execution: record.execution, usage: record.usage,
    toolUses: record.blocks
        ? undefined
        : record.tools?.map(tool => ({ name: tool.name, summary: summariseTool(tool.name, tool.input) })),
    interrupted: record.interrupted,
    failureReason: record.role === 'assistant' && record.exitCode !== undefined && record.exitCode !== 0 && !record.interrupted
        ? record.endReason : undefined,
    truncated: record.truncated,
});

export const useChatConversation = (conversationId: string | null): ChatConversationView => {
    const workerClient = useWorkerClient();
    const { runtimes, open, clearSettledTurn, send: sendFrame } = useChatSocketContext();
    const [detail, setDetail] = useState<AgentConversationDetail | null>(null);
    const [loading, setLoading] = useState(conversationId !== null);
    const [handoverAttempt, setHandoverAttempt] = useState(0);

    const runtime = conversationId ? runtimes[conversationId] ?? null : null;

    const [seededId, setSeededId] = useState(conversationId);
    if (seededId !== conversationId) {
        setSeededId(conversationId);
        setDetail(null);
        setLoading(conversationId !== null);
        setHandoverAttempt(0);
    }

    useEffect(() => {
        // Watching is never given up here: a conversation the user switched away from must keep
        if (conversationId) open(conversationId);
    }, [conversationId, open]);

    const readTranscript = useCallback(async (id: string): Promise<AgentConversationDetail | null> => {
        try {
            return await workerClient.getAgentConversation(id);
        } catch {
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

    const liveTurnId = runtime?.turnId ?? null;

    const settledTurnId = runtime && !runtime.running && !runtime.settled && (runtime.turnId || runtime.lastError)
        ? runtime.turnId ?? ''
        : null;

    const readTurn = useRef<string | null>(null);

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
                // The hand-over happens only against a transcript that actually arrived: marking the turn settled after a failed read would drop.
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
            // No turn id means the prompt never reached a process — a refusal writes no transcript record, so there is nothing to hand over.
            if (settledTurnId) clearSettledTurn(conversationId, settledTurnId);
            setHandoverAttempt(0);
        });
        return () => { cancelled = true; clearTimeout(retry); };
    }, [conversationId, liveTurnId, settledTurnId, handoverAttempt, readTranscript, clearSettledTurn]);

    const messages = useMemo(() => {
        const settled = detail?.messages.map(toChatMessage) ?? NO_MESSAGES;
        if (!runtime) return settled;

        const live: ChatMessage[] = [];
        // A prompt of this tab's that nothing is coming for — refused, or queued behind a socket that is down.
        const unsent = runtime.pendingText && !runtime.running && !runtime.awaitingStart
            ? runtime.pendingText
            : '';
        const tail = settled[settled.length - 1];
        // How many of the live turn's betweens the transcript already holds.
        let recordedBetweens = 0;
        while (recordedBetweens < settled.length
            && settled[settled.length - 1 - recordedBetweens].between) recordedBetweens += 1;
        // The live turn is what the transcript does not hold yet: the prompt that was sent, and the reply as it streams.
        if (runtime.awaitingStart || (!runtime.settled && !runtime.arrivedFinished)) {
            // The runtime's copy of the prompt is only wanted before the transcript's exists: between hitting send and the process starting.
            if (runtime.userText && tail?.role !== 'user') {
                live.push({
                    id: 'live-user',
                    role: 'user',
                    content: runtime.userText,
                    pending: runtime.userText === unsent,
                });
            }
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
        // A message of attachments and no words is a message: "what is this?" is what dropping a screenshot into a chat says,.
        if (!conversationId || (!prompt && !opts.attachments?.length)) return;
        sendFrame({ type: 'prompt', conversationId, prompt, ...opts });
    }, [conversationId, sendFrame]);

    const sendBetween = useCallback((text: string) => {
        const between = text.trim();
        if (!conversationId || !between) return;
        sendFrame({ type: 'between', conversationId, text: between });
    }, [conversationId, sendFrame]);

    const sendFollowUp = useCallback((text: string) => {
        if (conversationId && text.trim()) sendFrame({ type: 'follow_up', conversationId, text: text.trim() });
    }, [conversationId, sendFrame]);
    const clearQueue = useCallback(() => {
        if (conversationId) sendFrame({ type: 'clear_queue', conversationId });
    }, [conversationId, sendFrame]);

    const stop = useCallback(() => {
        if (!conversationId) return;
        sendFrame({ type: 'stop', conversationId });
    }, [conversationId, sendFrame]);

    const decidePermission = useCallback((requestId: string, behavior: 'allow' | 'deny', message?: string) => {
        if (!conversationId) return;
        sendFrame({ type: 'permission_decision', conversationId, requestId, behavior, message });
    }, [conversationId, sendFrame]);

    const answerQuestions = useCallback((requestId: string, answers: string[]) => {
        if (!conversationId) return;
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
        sendFollowUp, clearQueue,
        queue: (runtime?.running || runtime?.queue?.length) ? runtime?.queue ?? [] : detail?.messages.filter(one => one.role === 'assistant').at(-1)?.queue ?? [],
        stop,
        decidePermission,
        answerQuestions,
    }), [detail, messages, runtime, loading, send, sendBetween, sendFollowUp, clearQueue, stop, decidePermission, answerQuestions]);
};
