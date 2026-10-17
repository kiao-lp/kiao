import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AGENT_PROTOCOL_VERSION } from 'kiao-worker';
import type { AgentClientMessage, AgentConversation, AgentServerMessage } from 'kiao-worker';

import { createChatSocketClient } from './chatSocketClient';

// ── Minimal driveable WebSocket double ────────────────────────────────────────

class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static instances: MockWebSocket[] = [];

    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    sent: string[] = [];

    constructor(public url: string) {
        MockWebSocket.instances.push(this);
    }

    send(data: string) {
        this.sent.push(data);
    }

    close() {
        this.readyState = 3;
        this.onclose?.();
    }

    // Test helpers
    open() {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.();
    }

    /** A drop nobody asked for — what a service restart looks like from the browser. */
    drop() {
        this.readyState = 3;
        this.onclose?.();
    }

    emit(msg: AgentServerMessage) {
        this.onmessage?.({ data: JSON.stringify(msg) });
    }

    get frames(): AgentClientMessage[] {
        return this.sent.map(raw => JSON.parse(raw));
    }
}

const ws = (index = MockWebSocket.instances.length - 1) => MockWebSocket.instances[index];

const hello = (protocolVersion = AGENT_PROTOCOL_VERSION): AgentServerMessage => ({
    type: 'hello', agents: ['claude'],
    protocolVersion,
    socketId: 'sock-1',
    runningConversations: [],
    maxConcurrentTurns: 4,
});

const conversation = (id: string): AgentConversation => ({
    id,
    title: 'A conversation',
    folder: 'units/demo',
    model: 'opus',
    effort: 'high',
    permissionMode: 'manual',
    agent: 'claude',
    thinking: true,
    running: false,
    archived: false,
    pinned: false,
    messageCount: 2,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
});

const client = () => createChatSocketClient(() => 'ws://localhost/api/ws/hybridflow-runner?access_token=tok');

beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('chatSocketClient — subscriptions', () => {
    it('subscribes once per newly watched conversation and not again for a repeat', () => {
        const socket = client();

        socket.watch('conv-a', vi.fn());
        ws().open();
        socket.watch('conv-b', vi.fn());
        // A second listener on an id this socket already receives asks the server for nothing.
        socket.watch('conv-a', vi.fn());

        expect(ws().frames).toEqual([
            { type: 'subscribe', conversationIds: ['conv-a'] },
            { type: 'subscribe', conversationIds: ['conv-b'] },
        ]);
    });

    it('unsubscribes only when the last listener for an id goes away', () => {
        const socket = client();

        socket.watch('conv-a', vi.fn());
        ws().open();
        const disposeSecond = socket.watch('conv-a', vi.fn());

        disposeSecond();
        expect(ws().frames).toHaveLength(1);
    });

    it('opens one socket for the whole app, however many conversations are watched', () => {
        const socket = client();

        socket.watch('conv-a', vi.fn());
        socket.watch('conv-b', vi.fn());
        socket.onRegistry(vi.fn());

        expect(MockWebSocket.instances).toHaveLength(1);
    });
});

describe('chatSocketClient — routing', () => {
    it('delivers a conversation frame to that conversation only', () => {
        const socket = client();
        const onA = vi.fn();
        const onB = vi.fn();

        socket.watch('conv-a', onA);
        socket.watch('conv-b', onB);
        ws().open();
        ws().emit({ type: 'output', conversationId: 'conv-a', turnId: 't1', index: 0, kind: 'text', data: 'hello' });

        expect(onA).toHaveBeenCalledWith({ type: 'output', conversationId: 'conv-a', turnId: 't1', index: 0, kind: 'text', data: 'hello' });
        expect(onB).not.toHaveBeenCalled();
    });

    it('delivers registry frames to a listener that subscribes to nothing', () => {
        const socket = client();
        const onRegistry = vi.fn();
        const onFrame = vi.fn();

        socket.onRegistry(onRegistry);
        ws().open();
        ws().emit({ type: 'conversation', conversationId: 'conv-z', conversation: conversation('conv-z') });

        expect(onRegistry).toHaveBeenCalledWith(expect.objectContaining({ type: 'conversation', conversationId: 'conv-z' }));
        expect(onFrame).not.toHaveBeenCalled();
    });

    it('queues a send made before the socket is open and flushes it after the subscriptions', () => {
        const socket = client();

        socket.watch('conv-a', vi.fn());
        socket.send({ type: 'prompt', conversationId: 'conv-a', prompt: 'do the thing' });
        ws().open();

        expect(ws().frames).toEqual([
            { type: 'subscribe', conversationIds: ['conv-a'] },
            { type: 'prompt', conversationId: 'conv-a', prompt: 'do the thing' },
        ]);
    });

    it('drops a queued prompt the socket only comes back long after', () => {
        vi.useFakeTimers();
        const socket = client();

        socket.watch('conv-a', vi.fn());
        socket.send({ type: 'prompt', conversationId: 'conv-a', prompt: 'do the thing' });
        // A service that was down for the afternoon. Starting a turn now, on a prompt whoever typed
        // it has long since given up on, is worse than not starting one at all.
        vi.advanceTimersByTime(60_000);
        ws().open();

        expect(ws().frames).toEqual([{ type: 'subscribe', conversationIds: ['conv-a'] }]);
    });

    it('says so when it gives up on a prompt, rather than losing it quietly', () => {
        vi.useFakeTimers();
        const socket = client();
        const dropped: [string, string][] = [];
        socket.onPromptDropped((conversationId, prompt) => dropped.push([conversationId, prompt]));

        socket.watch('conv-a', vi.fn());
        socket.send({ type: 'prompt', conversationId: 'conv-a', prompt: 'do the thing' });
        vi.advanceTimersByTime(60_000);
        ws().open();

        // The text was typed into a box the panel has already emptied, and nothing else holds it.
        // A prompt dropped without a word reads exactly like one that was sent and ignored.
        expect(dropped).toEqual([['conv-a', 'do the thing']]);
    });

    it('says so at once when this bundle is too old to ever send it', () => {
        const socket = client();
        const dropped: [string, string][] = [];
        socket.onPromptDropped((conversationId, prompt) => dropped.push([conversationId, prompt]));

        socket.watch('conv-a', vi.fn());
        ws().open();
        ws().emit(hello(AGENT_PROTOCOL_VERSION + 1));
        socket.send({ type: 'prompt', conversationId: 'conv-a', prompt: 'do the thing' });

        // No socket will ever open again, so holding this one in the queue only makes it look like a
        // message on its way. It is handed back the moment it is asked for instead.
        expect(dropped).toEqual([['conv-a', 'do the thing']]);
    });

    it('still sends a queued prompt across a restart nobody notices', () => {
        vi.useFakeTimers();
        const socket = client();

        socket.watch('conv-a', vi.fn());
        socket.send({ type: 'prompt', conversationId: 'conv-a', prompt: 'do the thing' });
        vi.advanceTimersByTime(800);
        ws().open();

        expect(ws().frames).toContainEqual({ type: 'prompt', conversationId: 'conv-a', prompt: 'do the thing' });
    });

    it('sends a queued stop however long the socket was away', () => {
        vi.useFakeTimers();
        const socket = client();

        socket.watch('conv-a', vi.fn());
        socket.send({ type: 'stop', conversationId: 'conv-a' });
        vi.advanceTimersByTime(60_000);
        ws().open();

        // Nothing times out a turn parked on a permission request, so one the user asked to stop may
        // well still be running — and a stop is as wanted late as it was on time.
        expect(ws().frames).toContainEqual({ type: 'stop', conversationId: 'conv-a' });
    });
});

describe('chatSocketClient — reconnection', () => {
    it('re-subscribes every watched conversation in a single frame', () => {
        vi.useFakeTimers();
        const socket = client();
        const states: string[] = [];
        socket.onState(state => states.push(state));

        socket.watch('conv-a', vi.fn());
        socket.watch('conv-b', vi.fn());
        ws().open();
        ws().drop();
        vi.advanceTimersByTime(500);
        expect(MockWebSocket.instances).toHaveLength(2);
        ws().open();

        expect(ws().frames).toEqual([{ type: 'subscribe', conversationIds: ['conv-a', 'conv-b'] }]);
        expect(states).toEqual(['closed', 'connecting', 'open', 'closed', 'connecting', 'open']);
    });

    it('stops reconnecting and reports itself outdated on a foreign protocol version', () => {
        vi.useFakeTimers();
        const socket = client();
        let state = '';
        socket.onState(next => { state = next; });

        socket.watch('conv-a', vi.fn());
        ws().open();
        ws().emit(hello(AGENT_PROTOCOL_VERSION + 1));

        expect(state).toBe('outdated');
        // A reconnect would only reproduce the mismatch, so no amount of waiting opens another one.
        vi.advanceTimersByTime(60_000);
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('keeps running on a hello that matches this bundle', () => {
        const socket = client();
        const onHello = vi.fn();
        let state = '';
        socket.onState(next => { state = next; });

        socket.onHello(onHello);
        ws().open();
        ws().emit(hello());

        expect(onHello).toHaveBeenCalledWith(expect.objectContaining({ maxConcurrentTurns: 4 }));
        expect(state).toBe('open');
    });
});
