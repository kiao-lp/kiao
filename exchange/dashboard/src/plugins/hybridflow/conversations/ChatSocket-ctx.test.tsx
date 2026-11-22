import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { HARNESS_PROTOCOL_VERSION } from 'kiao-worker';
import type { HarnessServerMessage } from 'kiao-worker';

vi.mock('@kiao-dashboard-core', () => ({ useAuthToken: () => 'tok' }));

import { ChatSocketProvider, useChatSocketContext } from './ChatSocket-ctx';
import type { ChatSocketContextValue } from './ChatSocket-ctx';

// A driveable WebSocket. the only way to hold that promise up against a transport that cannot keep it is to drive one.

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

    send() {}

    close() {
        this.readyState = 3;
        this.onclose?.();
    }

    open() {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.();
    }


    drop() {
        this.readyState = 3;
        this.onclose?.();
    }

    emit(msg: HarnessServerMessage) {
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
            type: 'hello', harnesses: ['claude'],
            protocolVersion: HARNESS_PROTOCOL_VERSION + 1,
            socketId: 'sock-1',
            runningConversations: [],
            maxConcurrentTurns: 4,
        }); });

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

        expect(pending()).toBe('do the thing');
        expect(running()).toBe('false');
    });

    it('takes the prompt back down when the transport gives up on it', () => {
        vi.useFakeTimers();
        renderProvider();
        act(() => { socket().drop(); });
        sendPrompt();
        expect(pending()).toBe('do the thing');

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
            thinking: true, permissionMode: 'manual', harness: 'claude', folder: 'units/demo', startedAt: 1,
        }); });

        act(() => { socket().drop(); });

        expect(running()).toBe('true');
    });
});
