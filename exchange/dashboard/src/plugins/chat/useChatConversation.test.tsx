import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from 'src/test/render';
import { MockWebSocket } from 'src/test/webSocket';
import type { AgentConversationDetail, AgentMessageRole, AgentServerMessage } from 'kiao-worker';

const client = vi.hoisted(() => ({ getAgentConversation: vi.fn() }));

vi.mock('@cms-core', () => ({ useAuthToken: () => 'tok', useWorkerClient: () => client }));

import { ChatSocketProvider } from './ChatSocket-ctx';
import type { ChatMessage } from './chatMessages';
import { useChatConversation } from './useChatConversation';
import type { ChatConversationView, SendOptions } from './useChatConversation';

// ── A driveable WebSocket, so the panel is exercised over the real provider ────
//
// The join between the socket's live turn and the REST transcript is what is under test here, and
// standing in for either half would assert it against a mock of the thing that is wrong.

const socket = () => MockWebSocket.instances[MockWebSocket.instances.length - 1];

/** Everything a frame goes through happens in a listener, so every emit moves React state. */
const emit = (msg: AgentServerMessage) => act(() => { socket().emit(msg); });

const promptFrames = () => socket().sent.map(raw => JSON.parse(raw)).filter(frame => frame.type === 'prompt');

const betweenFrames = () => socket().sent.map(raw => JSON.parse(raw)).filter(frame => frame.type === 'between');

const OPTS: SendOptions = { model: 'haiku', effort: 'low', thinking: true, permissionMode: 'manual' };

/** One transcript line: a role, its text, and whether it was said into a running turn. */
type Line = [AgentMessageRole, string] | [AgentMessageRole, string, 'between'];

const transcript = (id: string, ...lines: Line[]): AgentConversationDetail => ({
    id,
    title: 'A conversation',
    folder: 'units/demo',
    model: 'haiku',
    effort: 'low',
    permissionMode: 'manual',
    agent: 'claude',
    thinking: true,
    running: false,
    archived: false,
    pinned: false,
    messageCount: lines.length,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    messages: lines.map(([role, text, between], index) => ({
        id: `${id}-m${index}`, role, text, at: '2026-01-01T00:00:00Z', between: between === 'between',
    })),
});

// ── The panel's half ──────────────────────────────────────────────────────────

/**
 * Every chat that reached the screen, in order. Recorded from a layout effect rather than during
 * the render: a render React throws away before committing it is one nobody ever saw, and only what
 * was committed can have mixed two conversations in front of the user.
 */
let commits: { id: string | null; lines: string[]; loading: boolean }[] = [];
let view: ChatConversationView | null = null;

// What a bubble says, wherever it keeps it: a reply recorded in order holds its text in blocks, and
// everything else — a prompt, a notice, a record from before blocks existed — in `content`.
const bubbleText = (message: ChatMessage) =>
    message.blocks
        ? message.blocks.map(block => (block.kind === 'tool_use' ? block.summary : block.text)).join('')
        : message.content;

const Panel: React.FC<{ id: string | null }> = ({ id }) => {
    const current = useChatConversation(id);
    view = current;
    const lines = current.messages.map(
        message => `${message.between ? 'between' : message.role}: ${bubbleText(message)}`,
    );
    const loading = current.loading;
    React.useLayoutEffect(() => { commits.push({ id, lines, loading }); });
    return <div data-testid="chat">{lines.join(' | ')}</div>;
};

const renderPanel = (id: string | null) => {
    const result = render(<ChatSocketProvider><Panel id={id} /></ChatSocketProvider>);
    act(() => { socket().open(); });
    return {
        show: (next: string | null) => result.rerender(<ChatSocketProvider><Panel id={next} /></ChatSocketProvider>),
        // Navigating to another document: every main view brings its own <LayoutContent>, hence its
        // own toolbar, so the panel is unmounted and a new one is built when the user comes back.
        // The provider is app-level and stays — which is the whole point of it being one.
        navigateAway: () => result.rerender(<ChatSocketProvider><span /></ChatSocketProvider>),
    };
};

const chat = () => screen.getByTestId('chat').textContent ?? '';

const start = (conversationId: string, turnId: string): AgentServerMessage => ({
    type: 'start',
    conversationId,
    turnId,
    model: 'haiku',
    effort: 'low',
    thinking: true,
    permissionMode: 'manual',
    agent: 'claude',
    folder: 'units/demo',
    startedAt: 1,
});

beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    commits = [];
    view = null;
    vi.stubGlobal('WebSocket', MockWebSocket);
    client.getAgentConversation.mockImplementation((id: string) => Promise.resolve(transcript(id, ['user', `ask ${id}`])));
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useChatConversation — a refused prompt', () => {
    it('keeps the refused prompt on screen in a conversation that has already run a turn', async () => {
        client.getAgentConversation.mockResolvedValue(
            transcript('conv-a', ['user', 'first prompt'], ['assistant', 'first reply']),
        );
        const panel = renderPanel('conv-a');
        await waitFor(() => expect(chat()).toContain('first reply'));

        // A conversation with a turn behind it: the runtime is on that turn's epoch, which is where
        // the optimistic send deliberately leaves it — the next turn's id is the server's to mint.
        emit({
            type: 'sync', permissionMode: 'manual', agent: 'claude', conversationId: 'conv-a', turnId: 't1', running: false,
            userText: 'first prompt', blocks: [{ kind: 'text', text: 'first reply' }], startedAt: 1,
        });
        await waitFor(() => expect(chat()).toBe('user: first prompt | assistant: first reply'));

        act(() => { view!.send('second prompt', OPTS); });
        expect(chat()).toContain('user: second prompt');

        emit({
            type: 'error', conversationId: 'conv-a', code: 'bad_folder',
            message: "The conversation's folder is unusable: units/demo",
        });
        expect(chat()).toContain('user: second prompt');

        // Away to look at the folder that was refused, and back — which reads the transcript afresh
        // into a panel that is a new one. A refusal writes no transcript record and carries no turn,
        // so the prompt is in neither half of what comes back: this tab is all there is holding it.
        client.getAgentConversation.mockResolvedValue(
            transcript('conv-a', ['user', 'first prompt'], ['assistant', 'first reply'], ['notice', 'read again']),
        );
        panel.navigateAway();
        panel.show('conv-a');

        await waitFor(() => expect(chat()).toContain('read again'));
        expect(chat()).toContain('user: second prompt');
        expect(view!.lastError?.code).toBe('bad_folder');
    });
});

describe('useChatConversation — reattaching to a turn that has already finished', () => {
    it('never renders the last exchange under itself on a reload', async () => {
        client.getAgentConversation.mockResolvedValue(
            transcript('conv-a', ['user', 'do the thing'], ['assistant', 'the whole reply']),
        );
        renderPanel('conv-a');
        await waitFor(() => expect(chat()).toContain('the whole reply'));

        // A reload within the hub's job TTL: the subscribe is answered with the last held turn,
        // whose records the transcript has held since it finished.
        emit({
            type: 'sync', permissionMode: 'manual', agent: 'claude', conversationId: 'conv-a', turnId: 't1', running: false,
            userText: 'do the thing', blocks: [{ kind: 'text', text: 'the whole reply' }], startedAt: 1,
        });

        expect(chat()).toBe('user: do the thing | assistant: the whole reply');
        // Not for one frame either: the hand-over read takes a round trip, and a ladder of retries
        // when it fails.
        await waitFor(() => expect(client.getAgentConversation.mock.calls.length).toBeGreaterThan(1));
        expect(commits.filter(entry => entry.lines.length > 2)).toEqual([]);

        // Two reads for the whole reload, not three: the turn this `sync` brings is both new to this
        // tab and already finished, and one GET answers both halves of that.
        await act(async () => { await Promise.resolve(); });
        expect(client.getAgentConversation).toHaveBeenCalledTimes(2);
    });
});

describe('useChatConversation — a refused prompt outliving a reconnect', () => {
    it('keeps the refused prompt and the refusal when the socket comes back', async () => {
        client.getAgentConversation.mockResolvedValue(
            transcript('conv-a', ['user', 'first prompt'], ['assistant', 'first reply']),
        );
        renderPanel('conv-a');
        await waitFor(() => expect(chat()).toContain('first reply'));

        act(() => { view!.send('second prompt', OPTS); });
        emit({
            type: 'error', conversationId: 'conv-a', code: 'bad_folder',
            message: "The conversation's folder is unusable: units/demo",
        });
        await waitFor(() => expect(chat()).toContain('user: second prompt'));

        // The socket blips — a laptop waking, an nginx reload — and every watched conversation is
        // subscribed again. The hub answers with the turn it still holds, which is not the prompt it
        // refused: that one was never started, never recorded, and exists in this tab alone.
        emit({
            type: 'sync', permissionMode: 'manual', agent: 'claude', conversationId: 'conv-a', turnId: 't1', running: false,
            userText: 'first prompt', blocks: [{ kind: 'text', text: 'first reply' }], startedAt: 1,
        });

        await waitFor(() => expect(chat()).toContain('user: second prompt'));
        // And with it the reason, so the notice above the input still says why.
        expect(view!.lastError?.code).toBe('bad_folder');
    });
});

describe('useChatConversation — saying something into a running turn', () => {
    const between = (text: string): AgentServerMessage =>
        ({ type: 'between', conversationId: 'conv-a', turnId: 't1', text });

    it('sends it as a between and shows it above the reply it is changing', async () => {
        client.getAgentConversation.mockResolvedValue(transcript('conv-a', ['user', 'count to a hundred']));
        renderPanel('conv-a');
        await waitFor(() => expect(chat()).toContain('count to a hundred'));

        emit(start('conv-a', 't1'));
        emit({ type: 'output', conversationId: 'conv-a', turnId: 't1', index: 0, kind: 'text', data: '1, 2, 3' });

        act(() => { view!.sendBetween('  stop at ten  '); });
        expect(betweenFrames()).toEqual([{ type: 'between', conversationId: 'conv-a', text: 'stop at ten' }]);

        // Nothing is on screen until the service says so: it records the message and echoes it to
        // every tab watching the turn, so the bubble comes from the same place a second tab's does.
        expect(chat()).not.toContain('stop at ten');

        emit(between('stop at ten'));
        // Above the reply, not below it: the reply is one bubble for the whole turn, and this is the
        // order the transcript reads them back in once it settles.
        expect(chat()).toBe('user: count to a hundred | between: stop at ten | assistant: 1, 2, 3');
    });

    it('never shows it twice once the transcript has been read since it was said', async () => {
        client.getAgentConversation.mockResolvedValue(transcript('conv-a', ['user', 'count to a hundred']));
        const panel = renderPanel('conv-a');
        await waitFor(() => expect(chat()).toContain('count to a hundred'));

        emit(start('conv-a', 't1'));
        emit({ type: 'output', conversationId: 'conv-a', turnId: 't1', index: 0, kind: 'text', data: '1, 2, 3' });
        emit(between('stop at ten'));
        expect(chat()).toContain('between: stop at ten');

        // The service records a between the moment it is said, so a transcript read *after* it comes
        // back holding it — which is what looking away from the conversation and back does. The
        // runtime is still holding it too, and the turn has not ended, so nothing has handed over.
        client.getAgentConversation.mockResolvedValue(
            transcript('conv-a', ['user', 'count to a hundred'], ['user', 'stop at ten', 'between']),
        );
        panel.navigateAway();
        panel.show('conv-a');

        await waitFor(() => expect(chat()).toContain('between: stop at ten'));
        expect(chat()).toBe('user: count to a hundred | between: stop at ten | assistant: 1, 2, 3');

        // And a second one said afterwards still lands, once: only the overlap is skipped.
        emit(between('and skip seven'));
        expect(chat()).toBe(
            'user: count to a hundred | between: stop at ten | between: and skip seven | assistant: 1, 2, 3',
        );
    });

    it('sends nothing at all for a message that is only whitespace', async () => {
        renderPanel('conv-a');
        await waitFor(() => expect(chat()).toContain('ask conv-a'));
        emit(start('conv-a', 't1'));

        act(() => { view!.sendBetween('   \n  '); });

        // The service drops an empty between without a word — there is no message on screen for a
        // refusal to be about — so a client that sent one would simply have nudged the turn for
        // nothing.
        expect(betweenFrames()).toEqual([]);
    });
});

describe('useChatConversation — a prompt sent while the socket is down', () => {
    it('shows it as a message that has not been answered rather than swallowing it', async () => {
        renderPanel('conv-a');
        await waitFor(() => expect(chat()).toContain('ask conv-a'));

        // A service being redeployed: the socket is in backoff, and the panel has already emptied
        // the textarea. Nothing else holds the text.
        act(() => { socket().close(); });
        act(() => { view!.send('do the thing', OPTS); });

        expect(chat()).toContain('user: do the thing');
        // Not running, though: no process exists and nothing can be stopped.
        expect(view!.running).toBe(false);
    });
});

describe('useChatConversation — the driver remarking on a quiet turn', () => {
    it('exposes the latest notice until the turn ends', async () => {
        renderPanel('conv-a');
        await waitFor(() => expect(chat()).toContain('ask conv-a'));
        emit(start('conv-a', 't1'));
        expect(view!.notice).toBeNull();

        emit({ type: 'notice', conversationId: 'conv-a', turnId: 't1', text: 'Muse has been quiet for 2m0s; the turn is still running.' });
        expect(view!.notice).toBe('Muse has been quiet for 2m0s; the turn is still running.');

        // Each remark supersedes the last — the view never holds more than one.
        emit({ type: 'notice', conversationId: 'conv-a', turnId: 't1', text: 'Muse has been quiet for 4m0s; the turn is still running.' });
        expect(view!.notice).toBe('Muse has been quiet for 4m0s; the turn is still running.');

        emit({ type: 'done', conversationId: 'conv-a', turnId: 't1' });
        expect(view!.notice).toBeNull();
        // The reads the turn triggered — one for the `start`, one for the handover the end
        // needs — awaited rather than left to land after the test: a settlement nobody waits
        // for is an act warning in the next test's output.
        await waitFor(() => expect(client.getAgentConversation).toHaveBeenCalledTimes(3));
    });

    it('drops the notice once the host speaks again', async () => {
        renderPanel('conv-a');
        await waitFor(() => expect(chat()).toContain('ask conv-a'));
        emit(start('conv-a', 't1'));
        emit({ type: 'notice', conversationId: 'conv-a', turnId: 't1', text: 'Muse has been quiet for 2m0s; the turn is still running.' });
        expect(view!.notice).toBe('Muse has been quiet for 2m0s; the turn is still running.');

        // Thinking, then a tool call: the quiet spell is over, but the turn is not.
        emit({ type: 'output', conversationId: 'conv-a', turnId: 't1', index: 0, kind: 'thinking', data: 'back' });
        expect(view!.notice).toBeNull();
        expect(view!.running).toBe(true);

        emit({ type: 'notice', conversationId: 'conv-a', turnId: 't1', text: 'Muse has been quiet for 2m0s; the turn is still running.' });
        emit({ type: 'tool_use', conversationId: 'conv-a', turnId: 't1', index: 1, name: 'Read', input: 'a.md' });
        expect(view!.notice).toBeNull();
        expect(view!.running).toBe(true);

        emit({ type: 'done', conversationId: 'conv-a', turnId: 't1' });
        await waitFor(() => expect(client.getAgentConversation).toHaveBeenCalledTimes(3));
    });
});
