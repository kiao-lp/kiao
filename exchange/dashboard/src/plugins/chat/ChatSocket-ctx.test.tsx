import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { AGENT_PROTOCOL_VERSION } from 'kiao-worker';
import type { AgentServerMessage } from 'kiao-worker';

vi.mock('@cms-core', () => ({ useAuthToken: () => 'tok' }));

import { ChatSocketProvider, useChatSocketContext } from './ChatSocket-ctx';
import type { ChatSocketContextValue } from './ChatSocket-ctx';

// ── A driveable WebSocket ─────────────────────────────────────────────────────
//
// What is under test is the optimistic `running` the provider sets before the frame is written, and
// the only way to hold that promise up against a transport that cannot keep it is to drive one.

class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static instances: MockWebSocket[] = [];

    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(public url: string) {
        MockWebSocket.instances.push(this);
    }

    send() { /* these tests assert on the runtime map, never on what was written */ }

    close() {
        this.readyState = 3;
        this.onclose?.();
    }

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
}

const socket = () => MockWebSocket.instances[MockWebSocket.instances.length - 1];

const CONV = 'conv-a';

let api: ChatSocketContextValue | null = null;

const Probe: React.FC = () => {
    const ctx = useChatSocketContext();
    api = ctx;
    return (
        <>
            <span data-testid="running">{String(ctx.runtimes[CONV]?.running ?? false)}</span>
            <span data-testid="pending">{ctx.runtimes[CONV]?.pendingText ?? ''}</span>
        </>
    );
};

const running = () => screen.getByTestId('running').textContent;
const pending = () => screen.getByTestId('pending').textContent;

const renderProvider = () => {
    render(<ChatSocketProvider><Probe /></ChatSocketProvider>);
    act(() => { api!.open(CONV); });
};

const sendPrompt = () => act(() => {
    api!.send({ type: 'prompt', conversationId: CONV, prompt: 'do the thing' });
});

beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    api = null;
    vi.stubGlobal('WebSocket', MockWebSocket);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('ChatSocketProvider — a prompt the transport cannot deliver', () => {
    it('releases the panel when this bundle turns out to be too old to speak to the service', () => {
        renderProvider();
        act(() => { socket().open(); });
        sendPrompt();
        expect(running()).toBe('true');

        act(() => { socket().emit({
            type: 'hello', agents: ['claude'],
            protocolVersion: AGENT_PROTOCOL_VERSION + 1,
            socketId: 'sock-1',
            runningConversations: [],
            maxConcurrentTurns: 4,
        }); });

        // No socket will ever open again, so no `start` can answer that prompt. Leaving it running
        // disables the textarea for good and offers a Stop that goes nowhere either.
        expect(running()).toBe('false');
    });

    it('releases the panel when the socket goes away with the prompt still queued', () => {
        renderProvider();
        // Never opened: the prompt is queued behind a socket that then fails.
        sendPrompt();
        expect(running()).toBe('true');

        act(() => { socket().drop(); });

        expect(running()).toBe('false');
    });

    it('still shows a prompt sent while the socket is down', () => {
        renderProvider();
        act(() => { socket().drop(); });

        sendPrompt();

        // The panel emptied the textarea when it sent, and the transport is holding the frame for a
        // socket that is not there. This is the only copy of what the user typed, so it goes on
        // screen — as a message with no turn behind it, which is what it is.
        expect(pending()).toBe('do the thing');
        expect(running()).toBe('false');
    });

    it('takes the prompt back down when the transport gives up on it', () => {
        vi.useFakeTimers();
        renderProvider();
        act(() => { socket().drop(); });
        sendPrompt();
        expect(pending()).toBe('do the thing');

        // A service that was down for a long minute. The transport will not start a turn on a prompt
        // whoever typed it gave up on, so the bubble that stood for it has to go too — leaving it up
        // says a message was sent when none was.
        act(() => { vi.advanceTimersByTime(60_000); });
        act(() => { socket().open(); });

        expect(pending()).toBe('');
    });

    it('leaves a turn the server confirmed running while the socket is away', () => {
        renderProvider();
        act(() => { socket().open(); });
        sendPrompt();
        act(() => { socket().emit({
            type: 'start', conversationId: CONV, turnId: 't1', model: 'haiku', effort: 'low',
            thinking: true, permissionMode: 'manual', agent: 'claude', folder: 'units/demo', startedAt: 1,
        }); });

        act(() => { socket().drop(); });

        // A turn keeps running on the server while the browser is away, and the `sync` that answers
        // the reconnect is what says how it ended. Only the optimistic bet is the provider's to call off.
        expect(running()).toBe('true');
    });
});
