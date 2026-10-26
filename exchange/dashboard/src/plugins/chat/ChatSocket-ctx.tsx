// ── The app-level chat socket ─────────────────────────────────────────────────
//
// Owns the one WebSocket of the page and the live turn of every conversation the app has opened.
// It is mounted through `CmsPlugin.providers`, so its lifetime is the page's rather than a view's:
// every plugin main view brings its own <LayoutContent> and therefore its own tool bars, so
// a socket owned by the panel would be torn down on each navigation between documents.
//
// It is also the only caller of `watch`. Because the frame listener is this store and not a
// component, a conversation the user is not looking at accumulates exactly as if it were displayed
// — which is the whole reason this lives at app level.
//
// PluginProviders mounts it whatever `chatEnabled` says, so nothing here may open a socket by
// itself: the transport connects on the first `watch`, `onRegistry` or `send`, all of which come
// from the panel.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AgentClientMessage, AgentRegistryMessage, AgentSocketMessage, AgentChainRunMessage } from 'kiao-worker';
import { useAuthToken } from '@cms-core';
import { createChatSocketClient } from './chatSocketClient';
import type { ChatSocketClient, ChatSocketState } from './chatSocketClient';
import { applyFrame, emptyRuntime } from './chatConversationReducer';
import type { ConversationRuntime } from './chatConversationReducer';

export interface ChatSocketContextValue {
    socketState: ChatSocketState;
    /** The live turn of every open conversation, keyed by id. */
    runtimes: Record<string, ConversationRuntime>;
    /**
     * Start watching. Safe to call repeatedly; only the first call for an id subscribes. There is
     * deliberately no counterpart on the view side — switching away from a conversation must not
     * stop it accumulating.
     */
    open: (conversationId: string) => void;
    /** Stop watching and forget the live turn. The turn itself keeps running. */
    close: (conversationId: string) => void;
    /** Drop a finished turn's bubbles once it has been re-read from REST. */
    clearSettledTurn: (conversationId: string, turnId: string) => void;
    send: (msg: AgentClientMessage) => void;
    onRegistry: (listener: (msg: AgentRegistryMessage) => void) => () => void;
    /** The board's run, whenever it changes. Broadcast to every socket, watched or not. */
    onChainRun: (listener: (msg: AgentChainRunMessage) => void) => () => void;
    /**
     * The frame the service opens with. It says what is running — turns, and the board's run —
     * before anything has been asked for, which is what a reconnecting tab repairs itself from.
     */
    onHello: (listener: (hello: AgentSocketMessage) => void) => () => void;
    /**
     * A prompt the transport gave up on, with the text so whoever emptied the box can put it back.
     * The runtime's own copy is already gone by the time this runs.
     */
    onPromptDropped: (
        listener: (conversationId: string, prompt: string, attachments: string[]) => void,
    ) => () => void;
}

const ChatSocketContext = createContext<ChatSocketContextValue | null>(null);

/**
 * Whether a frame handed to the transport now still stands a chance of being answered. `closed` is
 * retried, but a prompt queued behind a retry is aged out rather than replayed after an arbitrary
 * delay, and `outdated` never opens another socket at all. In both, marking the turn running would
 * disable the panel on a promise nothing can keep.
 */
const canReachTheService = (state: ChatSocketState): boolean =>
    state === 'open' || state === 'connecting';

export const useChatSocketContext = (): ChatSocketContextValue => {
    const ctx = useContext(ChatSocketContext);
    if (!ctx) throw new Error('useChatSocketContext must be used within ChatSocketProvider');
    return ctx;
};

/**
 * The token rides in the query string because a WebSocket handshake carries no `Authorization`
 * header — the same trick `useAuthenticatedFileUrl` uses for `<img>` and `<a>`.
 */
const buildSocketUrl = (token: string | undefined): string => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/api/ws/hybridflow-runner`;
    return token ? `${url}?access_token=${token}` : url;
};

export const ChatSocketProvider: React.FC<{ children?: ReactNode }> = ({ children }) => {
    const token = useAuthToken();
    // Read through a ref because the transport calls `buildUrl` afresh for every connection attempt:
    // a reconnect can happen long after the token that opened the first socket was minted.
    const tokenRef = useRef(token);
    tokenRef.current = token;

    const [client] = useState<ChatSocketClient>(
        () => createChatSocketClient(() => buildSocketUrl(tokenRef.current)),
    );
    const [socketState, setSocketState] = useState<ChatSocketState>('closed');
    const [runtimes, setRuntimes] = useState<Record<string, ConversationRuntime>>({});
    // One disposer per watched conversation. A ref rather than state: nothing renders from it, and
    // `open` has to tell a repeat call from a first one without waiting for a re-render.
    const watches = useRef(new Map<string, () => void>());

    useEffect(() => client.onState(setSocketState), [client]);

    // The optimistic `running` below is a bet that a `start` is on its way, and a transport that is
    // down — or `outdated`, which never opens another socket — cannot make good on it. Left standing,
    // it disables the textarea for good and offers a Stop that queues behind the prompt it would
    // cancel. A turn the server confirmed is untouched: it keeps running while the browser is away,
    // and the `sync` answering the reconnect is what says how it ended.
    useEffect(() => {
        if (canReachTheService(socketState)) return;
        setRuntimes(prev => {
            const stalled = Object.values(prev).filter(runtime => runtime.awaitingStart);
            if (!stalled.length) return prev;
            const next = { ...prev };
            stalled.forEach(runtime => {
                next[runtime.conversationId] = { ...runtime, running: false, awaitingStart: false };
            });
            return next;
        });
    }, [socketState]);

    // A prompt the transport gave up on will never be answered: no `start`, no refusal, nothing at
    // all. The bubble it put up has to come down with it, or it stands there reading as a message
    // that was sent — and the text goes back to the panel, which emptied the box when it sent.
    useEffect(() => client.onPromptDropped((conversationId, prompt) => {
        setRuntimes(prev => {
            const runtime = prev[conversationId];
            if (!runtime || runtime.pendingText !== prompt) return prev;
            return {
                ...prev,
                [conversationId]: {
                    ...runtime,
                    pendingText: '',
                    userText: runtime.userText === prompt ? '' : runtime.userText,
                    // Only the bet this provider made is called off. A `running` the service
                    // confirmed belongs to a turn that has nothing to do with the dropped frame.
                    running: runtime.awaitingStart ? false : runtime.running,
                    awaitingStart: false,
                },
            };
        });
    }), [client]);

    useEffect(() => () => {
        // The watches go; the socket does not. `close()` is terminal by design — it is what the
        // protocol-version guard uses — so closing it here would leave the remount React's
        // StrictMode performs on every dev mount without a socket at all. This provider is mounted
        // for the life of the page anyway, which is exactly the socket's intended lifetime.
        watches.current.forEach(dispose => dispose());
        watches.current.clear();
    }, []);

    const open = useCallback((conversationId: string) => {
        if (watches.current.has(conversationId)) return;
        const dispose = client.watch(conversationId, msg => {
            setRuntimes(prev => ({
                ...prev,
                [conversationId]: applyFrame(prev[conversationId] ?? emptyRuntime(conversationId), msg),
            }));
        });
        watches.current.set(conversationId, dispose);
        // Seeded so every reader gets one stable runtime object per conversation instead of minting
        // an empty one of its own on each render.
        setRuntimes(prev => (prev[conversationId]
            ? prev
            : { ...prev, [conversationId]: emptyRuntime(conversationId) }));
    }, [client]);

    const close = useCallback((conversationId: string) => {
        watches.current.get(conversationId)?.();
        watches.current.delete(conversationId);
        // The runtime goes with the subscription. Re-opening is answered with a `sync` or a
        // `not_running`, so keeping the turn of a conversation nobody watches would preserve nothing
        // the server cannot say again — and would keep a deleted conversation's text alive.
        setRuntimes(prev => {
            if (!(conversationId in prev)) return prev;
            const next = { ...prev };
            delete next[conversationId];
            return next;
        });
    }, []);

    const clearSettledTurn = useCallback((conversationId: string, turnId: string) => {
        setRuntimes(prev => {
            const runtime = prev[conversationId];
            // Fenced on the turn id: a turn that started while the transcript was being read is not
            // the one that was read, and marking it settled would hide a reply as it streams.
            if (!runtime || runtime.turnId !== turnId || runtime.settled) return prev;
            return { ...prev, [conversationId]: { ...runtime, settled: true } };
        });
    }, []);

    const send = useCallback((msg: AgentClientMessage) => {
        // A `between` deliberately claims nothing here. It starts no turn, so there is no spinner to
        // put up on its behalf, and the service records it and echoes it back before it has finished
        // handling the frame — so the `between` frame is on screen about as fast as a bet would have
        // been, and it is the truth rather than a guess. What happens if it never arrives is the
        // transport's business: it hands the text back through `onPromptDropped`, like a prompt.
        if (msg.type === 'prompt') {
            // A prompt handed to a transport that cannot reach the service is still queued — it may
            // yet go out on the next socket — but no turn is claimed on its behalf: the spinner and
            // the Stop button are for a turn that is about to exist, and the `start` that answers
            // the prompt is what brings them. The text is not a claim of any kind, and it is
            // recorded whatever the socket is doing: the panel emptied its box when it sent, so
            // this is the only copy of it there is.
            const reachable = canReachTheService(socketState);
            setRuntimes(prev => {
                const runtime = prev[msg.conversationId] ?? emptyRuntime(msg.conversationId);
                // A prompt sent into a running conversation is refused with `conversation_busy` and
                // never replaces the turn — so it must not clear that turn's bubbles either. The
                // text still goes up, because the refusal about to answer it needs something to
                // point at.
                if (runtime.running) {
                    return { ...prev, [msg.conversationId]: { ...runtime, pendingText: msg.prompt } };
                }
                return {
                    ...prev,
                    [msg.conversationId]: {
                        ...runtime,
                        // The epoch stays where it was: the new turn's id is minted by the server and
                        // arrives with `start`, and until then the old one still fences its own
                        // stragglers.
                        running: reachable,
                        // The prompt text exists nowhere else. `start` does not carry it and the
                        // server deliberately answers a prompt with no `sync`, so the sending tab is
                        // the only one that can show the user's own bubble before the reply begins;
                        // a later `sync` overwrites this same field with the server's copy.
                        userText: msg.prompt,
                        pendingText: msg.prompt,
                        blocks: [],
                        permissionRequests: [],
                        lastError: null,
                        // `settled` and `arrivedFinished` are left where they are. Both are claims
                        // about the turn at `turnId` — that the transcript holds it — and that is
                        // still the PREVIOUS turn, which sending a prompt says nothing about.
                        // Clearing them makes the two disagree, and the `sync` answering the next
                        // reconnect then replays that turn under the transcript's own copy of it.
                        // What says a prompt of this tab's is waiting for a turn is `awaitingStart`,
                        // which is what the view renders its optimistic bubbles from.
                        //
                        // No `start` has answered this prompt yet, which is what lets the effect
                        // above tell it from a turn the server confirmed.
                        awaitingStart: reachable,
                    },
                };
            });
        }
        client.send(msg);
    }, [client, socketState]);

    const value = useMemo(() => ({
        socketState,
        runtimes,
        open,
        close,
        clearSettledTurn,
        send,
        onRegistry: client.onRegistry,
        onChainRun: client.onChainRun,
        onHello: client.onHello,
        onPromptDropped: client.onPromptDropped,
    }), [socketState, runtimes, open, close, clearSettledTurn, send, client]);

    return <ChatSocketContext.Provider value={value}>{children}</ChatSocketContext.Provider>;
};
