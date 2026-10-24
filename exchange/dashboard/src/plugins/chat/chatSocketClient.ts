// ── The chat socket transport ─────────────────────────────────────────────────
//
// One WebSocket for the whole app, carrying every conversation. It is deliberately React-free: the
// socket has to outlive the components that read it — every plugin main view brings its own lateral
// toolbar, so a socket owned by a component is torn down on each navigation — and a plain object
// with listeners is what the app-level provider wraps.
//
// It knows about routing and nothing about meaning: which listener a frame belongs to, what to
// re-subscribe after a reconnect, and when this bundle is too old to route frames at all. What the
// frames say is `chatConversationReducer.ts`'s business.

import type {
    AgentClientMessage,
    AgentConversationMessage,
    AgentRegistryMessage,
    AgentServerMessage,
    AgentSocketMessage,
    AgentChainRunMessage,
} from 'kiao-worker';
import { AGENT_PROTOCOL_VERSION, isAgentRegistryMessage, isAgentChainRunMessage } from 'kiao-worker';

/**
 * `closed` is a socket that dropped and will be retried; `outdated` is terminal — the service
 * speaks a protocol this bundle cannot route, and only a reload fixes that.
 */
export type ChatSocketState = 'connecting' | 'open' | 'closed' | 'outdated';

export interface ChatSocketClient {
    /**
     * Watch a conversation. The disposer removes the listener and, when it was the last one for
     * that id, sends `unsubscribe`.
     */
    watch(conversationId: string, onFrame: (msg: AgentConversationMessage) => void): () => void;
    /**
     * Registry frames (`conversation`, `conversation_deleted`) reach every listener here,
     * subscribed or not — that is how a list stays live for conversations nobody is watching.
     */
    onRegistry(listener: (msg: AgentRegistryMessage) => void): () => void;
    /**
     * The board's run, whenever it changes. Like the registry frames it reaches every listener
     * here, subscribed to nothing: there is one run in the service and every tab has to agree about
     * what it is doing.
     */
    onChainRun(listener: (msg: AgentChainRunMessage) => void): () => void;
    onHello(listener: (hello: AgentSocketMessage) => void): () => void;
    onState(listener: (state: ChatSocketState) => void): () => void;
    /**
     * A message this transport will never send, handed back to whoever typed it: aged out of the
     * queue, or handed over after the version guard shut it down for good. Both frames that carry
     * something a user typed are reported — a `prompt` and a `between` — because dropping either
     * silently is indistinguishable, from the panel, from a message that was sent and ignored.
     * Every other frame acts on a turn that already exists, so giving up on one loses nothing.
     *
     * `attachments` are the ids the message named: the files are still on the server, so giving the
     * text back without them would let the second attempt go without the screenshot the first one
     * was about. A `between` never names any, and reports none.
     */
    onPromptDropped(
        listener: (conversationId: string, prompt: string, attachments: string[]) => void,
    ): () => void;
    send(msg: AgentClientMessage): void;
    close(): void;
}

/**
 * Reconnect delays, in order, holding at the last one. Short enough at the start that a service
 * restart is invisible, long enough at the end that a service which is down for the afternoon is
 * not hammered by every open tab.
 */
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];

/**
 * How long a prompt may sit in the send queue. Long enough to cover a service restart nobody
 * notices, short enough that a socket coming back from a real outage does not start a turn on a
 * prompt whoever typed it gave up on minutes ago — which is worse than never sending it, because
 * the panel that gave up is not watching for the reply.
 */
const QUEUED_PROMPT_MAX_AGE_MS = 10_000;

/**
 * `buildUrl` is called afresh for every connection attempt rather than once, because the URL
 * carries the access token and a reconnect can happen long after the first one was minted.
 */
export const createChatSocketClient = (buildUrl: () => string): ChatSocketClient => {
    const conversationListeners = new Map<string, Set<(msg: AgentConversationMessage) => void>>();
    const registryListeners = new Set<(msg: AgentRegistryMessage) => void>();
    const chainRunListeners = new Set<(msg: AgentChainRunMessage) => void>();
    const helloListeners = new Set<(hello: AgentSocketMessage) => void>();
    const stateListeners = new Set<(state: ChatSocketState) => void>();
    const dropListeners = new Set<(conversationId: string, prompt: string, attachments: string[]) => void>();

    let socket: WebSocket | null = null;
    let state: ChatSocketState = 'closed';
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // Each entry keeps the moment it was written, which is what lets the flush tell a frame the
    // socket was a moment late for from one it is now far too late for.
    let queued: { msg: AgentClientMessage; at: number }[] = [];
    // Set by `close()` and by the version guard. Both mean the same thing: never open another socket.
    let shutDown = false;

    const setState = (next: ChatSocketState) => {
        if (next === state) return;
        state = next;
        stateListeners.forEach(listener => listener(next));
    };

    /** Writes only when a socket is actually open; the caller decides what to do when it is not. */
    const write = (msg: AgentClientMessage): boolean => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        socket.send(JSON.stringify(msg));
        return true;
    };

    /**
     * Reports a frame nothing will ever send. Only the two frames carrying something the user typed
     * are worth reporting: every other one acts on a turn that already exists, so giving up on it
     * changes nothing that was written.
     */
    const giveUp = (msg: AgentClientMessage) => {
        if (msg.type === 'prompt') {
            dropListeners.forEach(listener => listener(msg.conversationId, msg.prompt, msg.attachments ?? []));
            return;
        }
        if (msg.type === 'between') {
            dropListeners.forEach(listener => listener(msg.conversationId, msg.text, []));
        }
    };

    /** Empties the queue for good, reporting every message in it. */
    const abandonQueue = () => {
        const abandoned = queued;
        queued = [];
        abandoned.forEach(({ msg }) => giveUp(msg));
    };

    const cancelRetry = () => {
        if (retryTimer === null) return;
        clearTimeout(retryTimer);
        retryTimer = null;
    };

    const scheduleRetry = () => {
        if (retryTimer !== null) return;
        const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        attempt += 1;
        retryTimer = setTimeout(() => {
            retryTimer = null;
            openSocket();
        }, delay);
    };

    const receive = (data: string) => {
        let msg: AgentServerMessage;
        try {
            msg = JSON.parse(data);
        } catch {
            console.warn('[agent socket] unparseable frame', data);
            return;
        }

        if (msg.type === 'hello') {
            if (msg.protocolVersion !== AGENT_PROTOCOL_VERSION) {
                // A bundle that cannot route this service's frames must stop rather than sit on a
                // socket it half-understands: reconnecting would only reproduce the mismatch, and
                // the state is what the UI turns into "reload Dashboard".
                console.warn('[agent socket] protocol mismatch', msg.protocolVersion, '≠', AGENT_PROTOCOL_VERSION);
                shutDown = true;
                cancelRetry();
                // Nothing will ever flush the queue, and holding a prompt nobody can send only makes
                // it look like one is still on its way.
                abandonQueue();
                socket?.close();
                socket = null;
                setState('outdated');
                return;
            }
            helloListeners.forEach(listener => listener(msg));
            return;
        }

        if (isAgentRegistryMessage(msg)) {
            registryListeners.forEach(listener => listener(msg));
            return;
        }

        if (isAgentChainRunMessage(msg)) {
            chainRunListeners.forEach(listener => listener(msg));
            return;
        }

        const listeners = conversationListeners.get(msg.conversationId);
        if (!listeners) {
            // Only reachable between an `unsubscribe` and the server acting on it.
            console.debug('[agent socket] frame for an unwatched conversation', msg.type, msg.conversationId);
            return;
        }
        listeners.forEach(listener => listener(msg));
    };

    const openSocket = () => {
        if (shutDown || socket) return;
        setState('connecting');
        const ws = new WebSocket(buildUrl());
        socket = ws;

        ws.onopen = () => {
            attempt = 0;
            setState('open');
            // One frame for every watched conversation, not one per conversation: after a reconnect
            // this is the whole repair, since each id is answered with a `sync` carrying the full
            // text of its live turn — so the deltas missed while the socket was down need no replay.
            const watched = [...conversationListeners.keys()];
            if (watched.length) write({ type: 'subscribe', conversationIds: watched });
            const pending = queued;
            queued = [];
            const now = Date.now();
            pending.forEach(({ msg, at }) => {
                // Only what somebody typed is dropped for age. Everything else acts on a turn that
                // already exists — a `stop`, an answer the CLI is still parked on, and nothing times
                // either of those out — so it is as wanted late as it was on time. A `between` is
                // held to the same clock as a prompt and is if anything the more perishable of the
                // two: it is a remark about a turn that may well have ended while the socket was
                // down, and the service refuses it then anyway.
                if ((msg.type === 'prompt' || msg.type === 'between') && now - at > QUEUED_PROMPT_MAX_AGE_MS) {
                    giveUp(msg);
                    return;
                }
                write(msg);
            });
        };

        ws.onmessage = event => receive(event.data);

        ws.onclose = () => {
            // A socket the version guard or `close()` already replaced must not report anything.
            if (socket !== ws) return;
            socket = null;
            if (shutDown) return;
            setState('closed');
            scheduleRetry();
        };
    };

    const watch = (conversationId: string, onFrame: (msg: AgentConversationMessage) => void) => {
        let listeners = conversationListeners.get(conversationId);
        if (!listeners) {
            listeners = new Set();
            conversationListeners.set(conversationId, listeners);
            // Only the first watcher of an id subscribes; the server's registration is per socket,
            // so a second one would ask for what this socket already receives. On a socket that is
            // not open yet nothing is sent here — the batch at open covers it.
            write({ type: 'subscribe', conversationIds: [conversationId] });
        }
        listeners.add(onFrame);
        openSocket();

        return () => {
            const current = conversationListeners.get(conversationId);
            if (!current) return;
            current.delete(onFrame);
            if (current.size) return;
            conversationListeners.delete(conversationId);
            write({ type: 'unsubscribe', conversationIds: [conversationId] });
        };
    };

    const send = (msg: AgentClientMessage) => {
        if (write(msg)) return;
        if (shutDown) {
            // No socket will ever open again, so a queue is a place for this to sit and look like a
            // message on its way. It is given back at once instead.
            giveUp(msg);
            return;
        }
        // Queued rather than dropped: a message is sent the moment the user hits enter, which is
        // routinely before the first socket has finished opening.
        queued.push({ msg, at: Date.now() });
        openSocket();
    };

    return {
        watch,
        onRegistry: listener => {
            registryListeners.add(listener);
            // Registry frames arrive unasked for, so wanting them is reason enough to connect: a
            // conversation list must go live without anything being watched.
            openSocket();
            return () => { registryListeners.delete(listener); };
        },
        onChainRun: listener => {
            chainRunListeners.add(listener);
            // Like the registry, and for the same reason: a run has to be watched by a tab that is
            // watching no conversation at all.
            openSocket();
            return () => { chainRunListeners.delete(listener); };
        },
        onHello: listener => {
            helloListeners.add(listener);
            openSocket();
            return () => { helloListeners.delete(listener); };
        },
        onState: listener => {
            stateListeners.add(listener);
            // Called at once with the current state: a subscriber that arrives after the socket
            // opened would otherwise show "closed" until the next transition, which may never come.
            listener(state);
            return () => { stateListeners.delete(listener); };
        },
        onPromptDropped: listener => {
            dropListeners.add(listener);
            return () => { dropListeners.delete(listener); };
        },
        send,
        close: () => {
            shutDown = true;
            cancelRetry();
            abandonQueue();
            socket?.close();
            socket = null;
            setState('closed');
        },
    };
};
