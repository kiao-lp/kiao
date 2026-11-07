
import type {
    AgentClientMessage,
    AgentConversationMessage,
    AgentRegistryMessage,
    AgentServerMessage,
    AgentSocketMessage,
    AgentChainRunMessage,
} from 'kiao-worker';
import { AGENT_PROTOCOL_VERSION, isAgentRegistryMessage, isAgentChainRunMessage } from 'kiao-worker';

/** `closed` is a socket that dropped and will be retried; `outdated` is terminal — the service speaks. */
export type ChatSocketState = 'connecting' | 'open' | 'closed' | 'outdated';

export interface ChatSocketClient {

    watch(conversationId: string, onFrame: (msg: AgentConversationMessage) => void): () => void;

    onRegistry(listener: (msg: AgentRegistryMessage) => void): () => void;

    onChainRun(listener: (msg: AgentChainRunMessage) => void): () => void;
    onHello(listener: (hello: AgentSocketMessage) => void): () => void;
    onState(listener: (state: ChatSocketState) => void): () => void;
    /** A message this transport will never send, handed back to whoever typed it: aged out of the queue. */
    onPromptDropped(
        listener: (conversationId: string, prompt: string, attachments: string[]) => void,
    ): () => void;
    send(msg: AgentClientMessage): void;
    close(): void;
}

/** Reconnect delays, in order, holding at the last one. */
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];

/** How long a prompt may sit in the send queue. */
const QUEUED_PROMPT_MAX_AGE_MS = 10_000;

/** `buildUrl` is called afresh for every connection attempt rather than once, because the URL carries. */
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
    let queued: { msg: AgentClientMessage; at: number }[] = [];
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


    const giveUp = (msg: AgentClientMessage) => {
        if (msg.type === 'prompt') {
            dropListeners.forEach(listener => listener(msg.conversationId, msg.prompt, msg.attachments ?? []));
            return;
        }
        if (msg.type === 'between') {
            dropListeners.forEach(listener => listener(msg.conversationId, msg.text, []));
        }
    };


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
                // A bundle that cannot route this service's frames must stop rather than sit on a socket it half-understands: reconnecting would.
                console.warn('[agent socket] protocol mismatch', msg.protocolVersion, '≠', AGENT_PROTOCOL_VERSION);
                shutDown = true;
                cancelRetry();
                // Nothing will ever flush the queue, and holding a prompt nobody can send only makes
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
            const watched = [...conversationListeners.keys()];
            if (watched.length) write({ type: 'subscribe', conversationIds: watched });
            const pending = queued;
            queued = [];
            const now = Date.now();
            pending.forEach(({ msg, at }) => {
                // Only what somebody typed is dropped for age.
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
            giveUp(msg);
            return;
        }
        queued.push({ msg, at: Date.now() });
        openSocket();
    };

    return {
        watch,
        onRegistry: listener => {
            registryListeners.add(listener);
            // conversation list must go live without anything being watched.
            openSocket();
            return () => { registryListeners.delete(listener); };
        },
        onChainRun: listener => {
            chainRunListeners.add(listener);
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
