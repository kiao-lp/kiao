import React from 'react';
import { formatLocalDateTime } from '@cms-kit/date-time';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from 'src/test/render';
import type { AgentPermissionMode, AgentChainRun } from 'kiao-worker';
import type { PermissionRequest } from './chatMessages';

// ── What the panel is given ───────────────────────────────────────────────────
//
// The panel is driven through its own hooks, all of which are stood in for: what is under test is
// what it does with a refusal and with a transport that cannot deliver, and both reach it as plain
// values.

const { createConversationMock, createConversationsMock } = await vi.hoisted(() => import('./test/mocks'));
const { permissionModes } = await vi.hoisted(() => import('src/test/agents'));

const state = vi.hoisted(() => ({
    ...createConversationMock(),
    ...createConversationsMock(),
    socketState: 'open' as 'open' | 'connecting' | 'closed' | 'outdated',
    // The modes the service offers, and the conversation the panel is looking at. Both are per-test
    // because a deployment may withdraw `bypassPermissions` while a conversation created before it
    // did still stores that mode.
    permissionModes: permissionModes(),
    // Whether this machine has an agent CLI on it at all. Empty is a real state now that neither
    // CLI is baked into the kiao image: the panel has to say so rather than offer a prompt
    // whose first message would come back refused.
    hasAgents: true,
    // Whether it has a *second* one. Per-test because the starters above the switcher are one per
    // agent, and because the lists a second engine publishes are its own: `opus` is a Claude model
    // and no model at all on Codex.
    hasCodex: false,
    claudeEnabled: true,
    // The Claude lists, per-test: one model and one effort by default, and no advertised pair —
    // which is a service too old to name one. A test that means the toolbar to show the service's
    // own default says the lists and the pair together.
    claudeEntry: null as null | {
        models: { value: string; label: string }[];
        efforts: { value: string; label: string }[];
        defaultModel?: string;
        defaultEffort?: string;
    },
    codexEntry: null as null | {
        models: { value: string; label: string }[];
        efforts: { value: string; label: string }[];
    },
    droppedListeners: new Set<(conversationId: string, prompt: string, attachments: string[]) => void>(),
    // The board's run, for the one question this panel asks about it: a run stopped with a chat is
    // picked back up — or dropped — by the next message said there.
    runs: [] as AgentChainRun[],
    stopRun: vi.fn(),
    resumeRun: vi.fn(() => Promise.resolve()),
    // What the host's CLI is, as far as the panel knows. Per-test because the sign-in banner is
    // rendered from it and nothing else.
    auth: { loggedIn: true, loginEnabled: true } as { loggedIn: boolean; loginEnabled: boolean } | null,
    codexAuth: vi.fn(),
    showTab: vi.fn(),
}));

vi.mock('@cms-core', async () => ({
    // A file dragged out of the tree onto the box is markdownLinkDrop.test's subject, not this
    // one's: here the handlers only have to be handlers.
    markdownLinkDropHandlers: () => ({}),
    useFileBrowsingPersistenceContext: () => ({ currentPath: 'units', currentFile: null }),
    useWorkerClient: () => ({ getAgentAuthStatus: state.codexAuth }),
    // The error notice links a signed-out failure to the Usage tab; here the tab switch only has
    // to be callable.
    useToolBars: () => ({ showTab: state.showTab }),
    // How a transcript renders is ChatMessageList.test's subject. Here a message only has to be
    // on the screen, so that the action it carries can be clicked.
    ConfiguredMarkdown: ({ children }: { children: string }) => <div>{children}</div>,
    zoomable: {},
    Tooltip: (await import('antd')).Tooltip,
}));

vi.mock('./ChatShow-ctx', () => ({
    useChatShow: () => ({ toShow: state.toShow, shown: state.shown }),
}));

vi.mock('./ChatChainRuns-ctx', () => ({
    useChatChainRuns: () => ({
        runs: state.runs, play: vi.fn(), stop: state.stopRun, resume: state.resumeRun,
        restart: vi.fn(), forget: vi.fn(),
    }),
}));

vi.mock('./ChatSocket-ctx', () => ({
    useChatSocketContext: () => ({
        socketState: state.socketState,
        runtimes: {},
        onPromptDropped: (listener: (conversationId: string, prompt: string, attachments: string[]) => void) => {
            state.droppedListeners.add(listener);
            return () => state.droppedListeners.delete(listener);
        },
    }),
}));

vi.mock('./useChatConversations', () => ({
    useChatConversations: () => ({
        conversations: state.conversations,
        // The invariant the panel keeps: a pinned conversation has a column of its own, so the main
        // column is never on one. Mirrored here rather than mocked away, because a mock that broke
        // it would have the panel render the same chat twice and call that the panel's fault.
        activeId: (state.conversations.find(entry => !entry.pinned)?.id as string) ?? null,
        setActiveId: vi.fn(), loading: false,
        create: state.create, show: state.show, fork: state.fork,
        patch: state.patch, remove: vi.fn(), refresh: vi.fn(),
    }),
}));

vi.mock('./useChatConversation', () => ({
    useChatConversation: () => ({
        conversation: null, messages: state.messages, running: state.running,
        permissionRequests: state.permissionRequests,
        questionRequests: state.questionRequests,
        lastError: state.lastError,
        loading: false,
        send: state.send, sendBetween: state.sendBetween, stop: state.stop,
        decidePermission: state.decidePermission,
        answerQuestions: state.answerQuestions,
    }),
}));

vi.mock('./useChatOptionLists', () => {
    // The default agent, whose permission modes are the per-test list: a deployment may withdraw
    // `bypassPermissions` while a conversation created before it did still stores that mode. A
    // second one joins it per-test, with lists of its own — which is the whole reason they are per
    // agent rather than per deployment.
    const claude = () => ({
        value: 'claude', label: 'Claude',
        models: state.claudeEntry?.models ?? [{ value: 'haiku', label: 'Haiku' }],
        efforts: state.claudeEntry?.efforts ?? [{ value: 'low', label: 'Low' }],
        permissionModes: state.permissionModes,
        ...(state.claudeEntry?.defaultModel ? { defaultModel: state.claudeEntry.defaultModel } : {}),
        ...(state.claudeEntry?.defaultEffort ? { defaultEffort: state.claudeEntry.defaultEffort } : {}),
    });
    const codex = () => ({
        value: 'codex', label: 'Codex',
        models: state.codexEntry?.models ?? [{ value: 'gpt-5', label: 'GPT-5' }],
        efforts: state.codexEntry?.efforts ?? [{ value: 'medium', label: 'Medium' }],
        permissionModes: [{ value: 'bypassPermissions', label: 'Bypass permissions' }],
    });
    const agents = () => [
        ...(state.claudeEnabled ? [claude()] : []),
        ...(state.hasCodex ? [codex()] : []),
    ];
    return {
        useChatOptionLists: () => ({
            agents: state.hasAgents ? agents() : [],
            defaultAgent: 'claude',
            models: claude().models,
            efforts: claude().efforts,
            permissionModes: state.permissionModes,
            optionsFor: (agent: string) => agents().find(entry => entry.value === agent) ?? claude(),
            loading: false,
        }),
    };
});

vi.mock('./useChatAuth', () => ({
    useChatAuth: () => ({ status: state.auth, loading: false, refresh: vi.fn() }),
}));

import { ChatPromptContent } from './ChatPrompt';

const textarea = () => screen.getByPlaceholderText(/Ask the agent/) as HTMLTextAreaElement;

/** The box of the main column, whichever of its two jobs it is doing. */
const messageBox = () => screen.getByLabelText(/^Message for/) as HTMLTextAreaElement;

beforeEach(() => {
    vi.clearAllMocks();
    state.socketState = 'open';
    state.hasAgents = true;
    state.hasCodex = false;
    state.claudeEntry = null;
    state.codexEntry = null;
    state.lastError = null;
    state.droppedListeners.clear();
    state.permissionRequests = [];
    state.questionRequests = [];
    state.running = false;
    state.runs = [];
    state.messages = [];
    state.fork.mockImplementation(() => Promise.resolve({}));
    state.conversations = [];
    state.toShow = null;
    state.auth = { loggedIn: true, loginEnabled: true };
    state.codexAuth.mockResolvedValue({ loggedIn: true, loginEnabled: true });
    state.claudeEnabled = true;
    state.patch.mockImplementation(() => Promise.resolve({}));
    state.permissionModes = permissionModes();
    // jsdom has no PointerEvent, and the resize bar is dragged with one. A MouseEvent carries every
    // coordinate the drag reads; only the pointer id has to be put back.
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
        readonly pointerId: number;

        constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 1;
        }
    });
    vi.stubGlobal('ResizeObserver', class {
        observe() { /* nothing to measure */ }
        unobserve() { /* nothing to measure */ }
        disconnect() { /* nothing to measure */ }
    });
    Element.prototype.scrollIntoView = vi.fn();
});

describe('ChatPromptContent — refusals the user has to be told about', () => {
    it('shows a provider reset in local datetime', () => {
        state.lastError = { code: 'cli_error', message: 'Your usage window resets at 2026-10-23T09:59:32Z' };
        render(<ChatPromptContent />);
        expect(screen.getByRole('alert')).toHaveTextContent(
            `Your usage window resets at ${formatLocalDateTime(Date.parse('2026-10-23T09:59:32Z'))}`,
        );
        expect(screen.getByRole('alert')).not.toHaveTextContent('2026-10-23T');
    });

    it('says why a turn was refused, whatever the reason was', () => {
        state.lastError = {
            code: 'too_many_turns',
            message: 'Claude is already running 4 turns at once; wait for one to finish.',
        };

        render(<ChatPromptContent />);

        // Every code lands here: nothing else answers a refusal, so a refused prompt would sit
        // under an empty chat saying nothing at all.
        expect(screen.getByText(/already running 4 turns/i)).toBeInTheDocument();
    });

    it('lets the notice be waved away', () => {
        state.lastError = { code: 'cli_error', message: 'a tool blew up' };

        render(<ChatPromptContent />);
        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

        expect(screen.queryByText(/a tool blew up/i)).not.toBeInTheDocument();
    });
});

// ── Saying something into a turn that is already running ─────────────────────
//
// The box has two jobs, and which one it is doing is `running`. Idle, Send starts a turn; while one
// runs, Send says something *into* it — folded into that turn at its next step, so it steers the
// reply on screen rather than queueing behind it. What is checked here is that the box does the
// second job at all (it used to be disabled outright), that it does the right one, and that a
// message the service could not deliver comes back to whoever typed it.

describe('ChatPromptContent — saying something into a running turn', () => {
    const sendButton = () => screen.getByRole('button', { name: /send/i });

    // A conversation is selected throughout: a between is about the turn running in one, and the
    // main column with nothing selected takes the other road entirely — it makes a conversation
    // first, which is a prompt's business and never a between's.
    beforeEach(() => {
        state.conversations = [{
            id: 'conv-1', title: 'Counting', folder: 'units', model: 'haiku', effort: 'low',
            permissionMode: 'manual', thinking: true, running: false, archived: false,
            pinned: false, messageCount: 2, createdAt: '', updatedAt: '',
        }];
    });

    it('keeps the box usable while a turn runs, and says what it will do with it', () => {
        state.running = true;

        render(<ChatPromptContent />);

        expect(messageBox()).not.toBeDisabled();
        expect(screen.getByPlaceholderText(/Add to what the turn is doing/)).toBeInTheDocument();
    });

    it('sends it into the running turn rather than starting one', () => {
        state.running = true;
        render(<ChatPromptContent />);

        fireEvent.change(messageBox(), { target: { value: 'stop at ten' } });
        fireEvent.click(sendButton());

        expect(state.sendBetween).toHaveBeenCalledWith('stop at ten');
        // A turn is already running; a prompt would be refused with `conversation_busy` and would
        // never replace it, which is the whole reason this is a frame of its own.
        expect(state.send).not.toHaveBeenCalled();
        expect(messageBox()).toHaveValue('');
    });

    it('offers Stop as well, since killing the turn is the other answer', () => {
        state.running = true;
        render(<ChatPromptContent />);

        fireEvent.click(screen.getByRole('button', { name: /stop/i }));

        expect(state.stop).toHaveBeenCalled();
        expect(sendButton()).toBeInTheDocument();
    });

    it('starts a turn with it once nothing is running', () => {
        render(<ChatPromptContent />);

        fireEvent.change(messageBox(), { target: { value: 'count to a hundred' } });
        fireEvent.click(sendButton());

        expect(state.send).toHaveBeenCalledWith('count to a hundred', expect.anything());
        expect(state.sendBetween).not.toHaveBeenCalled();
    });

    it('puts the message back in the box when the turn ended before it arrived', () => {
        state.running = true;
        const { rerender } = render(<ChatPromptContent />);

        fireEvent.change(messageBox(), { target: { value: 'stop at ten' } });
        fireEvent.click(sendButton());
        expect(messageBox()).toHaveValue('');

        // The turn settled in the round trip. Nothing was said into it, so the text is the user's
        // again — and the conversation is now idle enough to take the very same words as a prompt.
        state.running = false;
        state.lastError = { code: 'no_running_turn', message: 'That turn had already ended.' };
        rerender(<ChatPromptContent />);

        expect(messageBox()).toHaveValue('stop at ten');
        expect(screen.getByText(/already ended/i)).toBeInTheDocument();
    });
});

// ── Forking, asked of a message ───────────────────────────────────────────────
//
// A fork is a second conversation, so the panel is what makes one — the chat it was asked from only
// names the point. What is pinned here is the round trip: the message reaches the hook as the place
// to branch at, and its text comes back to the box, because a prompt worth branching at is one the
// user is about to ask again.

describe('ChatPromptContent — forking from a message', () => {
    it('branches at the message and hands its prompt back to the box', async () => {
        state.conversations = [{ id: 'conv-a', title: 'Alpha', folder: 'units', messageCount: 2, pinned: false }];
        state.messages = [{ id: 'msg-7', role: 'user', content: 'Rewrite the README' }];
        render(<ChatPromptContent />);

        fireEvent.click(screen.getByLabelText('Fork conversation from here'));

        await waitFor(() => expect(state.fork).toHaveBeenCalledWith('conv-a', 'msg-7'));
        // The copy stops short of that prompt, so the prompt itself is owed back to a box — and to
        // the *main* one, since a fork is never pinned and lands in the main column.
        await waitFor(() => expect(messageBox()).toHaveValue('Rewrite the README'));
    });

    it('withholds the action while a turn is running', () => {
        // The service refuses to fork a conversation it is still writing: the reply would land in one
        // of the two and not the other. An action that is always refused is better not offered.
        state.running = true;
        state.conversations = [{ id: 'conv-a', title: 'Alpha', folder: 'units', messageCount: 2, pinned: false }];
        state.messages = [{ id: 'msg-7', role: 'user', content: 'Rewrite the README' }];
        render(<ChatPromptContent />);

        expect(screen.queryByLabelText('Fork conversation from here')).toBeNull();
    });
});

// ── The sign-in banner ────────────────────────────────────────────────────────
//
// `ChatLoginPanel` has tests of its own, and every one of them would still pass if the panel were
// dropped from this file — which is the shape the bug keeps coming back in. What is checked here is
// only the wiring: a signed-out host reaches the screen, and it does so on a status that changed
// under a panel already mounted, since that is what a session ending at 8pm looks like from here.
describe('ChatPromptContent — a host that is not signed in', () => {
    it('hides the Claude warning when Claude is disabled while Codex remains enabled', () => {
        state.auth = { loggedIn: false, loginEnabled: true };
        const { rerender } = render(<ChatPromptContent />);
        expect(screen.getByText(/signed out on the server/i)).toBeInTheDocument();

        state.claudeEnabled = false;
        state.hasCodex = true;
        rerender(<ChatPromptContent />);
        expect(screen.queryByText(/signed out on the server/i)).toBeNull();
        expect(screen.queryByRole('button', { name: /New Claude conversation/ })).toBeNull();
        expect(screen.getByRole('button', { name: /New Codex conversation/ })).toBeInTheDocument();
    });

    it('disables sending in an existing conversation whose agent was disabled', () => {
        state.hasAgents = false;
        state.conversations = [{
            id: 'conv-disabled', agent: 'claude', title: 'Disabled agent', folder: 'units',
            model: 'haiku', effort: 'low', permissionMode: 'manual',
        }];
        render(<ChatPromptContent />);
        fireEvent.change(screen.getByRole('textbox', { name: 'Message for the agent' }), {
            target: { value: 'Should not send' },
        });
        expect(screen.getByRole('button', { name: /Send$/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Toggle extended thinking' })).toBeDisabled();
        expect(state.send).not.toHaveBeenCalled();
    });

    it('offers a way to sign in when the host is signed out', () => {
        state.auth = { loggedIn: false, loginEnabled: true };

        render(<ChatPromptContent />);

        expect(screen.getByText(/signed out on the server/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('brings the banner up when the session ends under an open panel', () => {
        const { rerender } = render(<ChatPromptContent />);
        expect(screen.queryByText(/signed out on the server/i)).not.toBeInTheDocument();

        state.auth = { loggedIn: false, loginEnabled: true };
        rerender(<ChatPromptContent />);

        // No reload happened here, and none should be needed: the panel is on screen throughout.
        expect(screen.getByText(/signed out on the server/i)).toBeInTheDocument();
    });

    it('says nothing while the host is signed in, or its status not yet known', () => {
        const { rerender } = render(<ChatPromptContent />);
        expect(screen.queryByText(/signed out on the server/i)).not.toBeInTheDocument();

        state.auth = null;
        rerender(<ChatPromptContent />);

        expect(screen.queryByText(/signed out on the server/i)).not.toBeInTheDocument();
    });
});

describe('ChatPromptContent — a transport that cannot deliver', () => {
    it('says the service is being reconnected to', async () => {
        const { rerender } = render(<ChatPromptContent />);
        state.socketState = 'closed';
        rerender(<ChatPromptContent />);

        // Silence here is what makes a prompt sent into a dropped socket look ignored.
        await waitFor(() => expect(screen.getByText(/reconnecting/i)).toBeInTheDocument());
    });

    it('says where to install an agent on a machine that has none', async () => {
        state.hasAgents = false;

        render(<ChatPromptContent />);

        // Not the socket's problem and not a refused turn: the machine simply has no CLI on it, and
        // the one place that fixes it is the configuration panel.
        await waitFor(() =>
            expect(screen.getByText(/No agent is enabled and available/i)).toBeInTheDocument());
        expect(screen.queryByText(/reconnecting/i)).not.toBeInTheDocument();
    });

    it('says nothing before anything has tried to connect', () => {
        state.socketState = 'closed';

        render(<ChatPromptContent />);

        // `closed` is also the transport's state before the first frame asks it to open a socket, and
        // a page that has only just mounted has not lost anything.
        expect(screen.queryByText(/reconnecting/i)).not.toBeInTheDocument();
    });

    it('gives back the text of a prompt the transport gave up on', () => {
        render(<ChatPromptContent />);

        act(() => { state.droppedListeners.forEach(listener => listener('conv-a', 'do the thing', [])); });

        // The textarea was emptied when the prompt was sent. Nothing else holds what was typed, so
        // it comes back to the one place the user can send it again from.
        expect(textarea().value).toBe('do the thing');
    });
});

// What the panel does with the cards a parked turn is waiting on. The countdown itself is
// worker's — a `manualLive` request arrives carrying the moment it will be allowed — so what
// is pinned here is that the panel shows what the request says and answers only what the user
// clicks.
describe('ChatPromptContent — the cards a parked turn is waiting on', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    const pending: PermissionRequest[] = [{ requestId: 'req-1', toolName: 'Edit', description: 'notes.md' }];

    it('counts down to the deadline the request carries, and decides nothing itself', () => {
        vi.useFakeTimers();
        state.permissionRequests = [{ ...pending[0], decideAt: Date.now() + 10_000 }];

        render(<ChatPromptContent />);

        expect(screen.getByText('Allowing in 10s')).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(30_000); });
        // The service allows it; the panel says so and waits for `permission_resolved` to take the
        // card away. A decision sent from here would be a second answer to a request already
        // answered.
        expect(state.decidePermission).not.toHaveBeenCalled();
    });

    it('never counts a question down, whatever the turn is running as', () => {
        vi.useFakeTimers();
        // A question has no answer to guess, so nothing — here or in the service — ever answers one
        // on the user's behalf.
        state.questionRequests = [{
            requestId: 'req-q',
            toolName: 'AskUserQuestion',
            questions: [{ question: 'Tabs or spaces?', options: [{ label: 'Tabs' }, { label: 'Spaces' }] }],
        }];

        render(<ChatPromptContent />);

        expect(screen.getByText('Tabs or spaces?')).toBeInTheDocument();
        expect(screen.queryByText(/Allowing in/)).not.toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(30_000); });
        expect(state.answerQuestions).not.toHaveBeenCalled();
        expect(state.decidePermission).not.toHaveBeenCalled();
    });

    it('sends what the user picked back to the turn that asked', () => {
        state.questionRequests = [{
            requestId: 'req-q',
            toolName: 'AskUserQuestion',
            questions: [{ question: 'Tabs or spaces?', options: [{ label: 'Tabs' }, { label: 'Spaces' }] }],
        }];

        render(<ChatPromptContent />);
        fireEvent.click(screen.getByText('Spaces'));
        fireEvent.click(screen.getByText('Answer'));

        expect(state.answerQuestions).toHaveBeenCalledWith('req-q', ['Spaces']);
    });

    it('says nothing about a countdown for a card the service will not decide', () => {
        vi.useFakeTimers();
        state.permissionRequests = pending;

        render(<ChatPromptContent />);

        expect(screen.queryByText(/Allowing in/)).not.toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(30_000); });
        expect(state.decidePermission).not.toHaveBeenCalled();
    });
});

// A deployment may withdraw `bypassPermissions` (KIAO_WORKER_CLAUDE_BYPASS_ENABLED=false in
// the worker), and then the mode is missing from the options *and* refused if asked for. The
// conversation that stores it was created before the withdrawal, so the panel has to land on a mode
// the service will actually run rather than display one every send would be refused for.
describe('ChatPromptContent — a permission mode the service no longer offers', () => {
    const bypassConversation = {
        id: 'conv-1', title: 'Old one', folder: 'units', model: 'haiku', effort: 'low',
        permissionMode: 'bypassPermissions', thinking: true, running: false, archived: false,
        pinned: false, messageCount: 0, createdAt: '', updatedAt: '',
    };

    it('shows the stored mode while it is still offered', () => {
        state.conversations = [bypassConversation];

        render(<ChatPromptContent />);

        expect(screen.getByTitle('Bypass')).toBeInTheDocument();
    });

    it('falls back to Manual when the service has withdrawn it', () => {
        state.conversations = [bypassConversation];
        state.permissionModes = [
            { value: 'manual', label: 'Manual' },
            { value: 'manualLive', label: 'Manual Live' },
        ];

        render(<ChatPromptContent />);

        expect(screen.queryByTitle('Bypass')).not.toBeInTheDocument();
        expect(screen.getByTitle('Manual')).toBeInTheDocument();
    });
});

// The service spells two of the modes in two words; the toolbar has room for one.
describe('ChatPromptContent — the permission mode in one word', () => {
    it('shows Manual Live as Live', () => {
        state.conversations = [{
            id: 'conv-1', title: 'Live one', folder: 'units', model: 'haiku', effort: 'low',
            permissionMode: 'manualLive', thinking: true, running: false, archived: false,
            pinned: false, messageCount: 0, createdAt: '', updatedAt: '',
        }];

        render(<ChatPromptContent />);

        expect(screen.getByTitle('Live')).toBeInTheDocument();
        expect(screen.queryByTitle('Manual Live')).not.toBeInTheDocument();
    });
});

// Pinning is the panel's own concern rather than a row's: a pinned conversation is taken out of the
// list and given a column beside it, so the two are shown at once instead of switched between.
describe('ChatPromptContent — a column per pinned conversation', () => {
    const conversation = (id: string, title: string, pinned: boolean) => ({
        id, title, folder: 'units', model: 'haiku', effort: 'low', permissionMode: 'manual',
        thinking: true, running: false, archived: false, pinned, messageCount: 0,
        createdAt: '', updatedAt: '',
    });

    const columns = () => document.querySelectorAll('.chat-column');

    it('is one column while nothing is pinned', () => {
        state.conversations = [conversation('conv-a', 'Alpha', false)];

        render(<ChatPromptContent />);

        expect(columns()).toHaveLength(1);
        expect(screen.getAllByPlaceholderText(/Claude|Continue the conversation/)).toHaveLength(1);
    });

    it('gives each pinned conversation a column of its own, with a chat in it', () => {
        state.conversations = [
            conversation('conv-a', 'Alpha', true),
            conversation('conv-b', 'Beta', true),
            conversation('conv-c', 'Gamma', false),
        ];

        render(<ChatPromptContent />);

        // Two pinned columns plus the one holding the list.
        expect(columns()).toHaveLength(3);
        // Each column is a chat in its own right, box and all — that is what makes it worth a column
        // rather than a second list.
        expect(screen.getAllByPlaceholderText(/Claude|Continue the conversation/)).toHaveLength(3);
        // A pinned conversation is out of the switcher: it is shown, not offered.
        fireEvent.mouseDown(document.querySelector('.chat-conversation-list .ant-select-content')!);
        expect([...document.querySelectorAll('.chat-conversation-popup .ant-select-item-option')]
            .map(item => item.textContent)).toEqual(['Gamma']);
        expect(document.querySelectorAll('.chat-conversation-row--header')).toHaveLength(2);
    });

    it('pins and unpins through the record, so every tab and the next session agree', async () => {
        state.conversations = [
            conversation('conv-a', 'Alpha', true),
            conversation('conv-b', 'Beta', false),
        ];

        render(<ChatPromptContent />);

        fireEvent.click(screen.getByLabelText('Pin'));
        expect(state.patch).toHaveBeenCalledWith('conv-b', { pinned: true });

        fireEvent.click(screen.getByLabelText('Unpin'));
        expect(state.patch).toHaveBeenCalledWith('conv-a', { pinned: false });
    });
});

// ── The message box's height ─────────────────────────────────────────────────
//
// The box is resized from the bar on its top edge, dragged upwards into the transcript. jsdom lays
// nothing out, so a box that has never been dragged measures zero and the drag starts from the
// minimum — which is exactly what the arithmetic below is stated in.
describe('ChatPromptContent — resizing the message box', () => {
    const grip = () => screen.getByRole('separator', { name: 'Resize the message box' });

    it('leaves the height to the stylesheet until the bar is moved', () => {
        render(<ChatPromptContent />);

        expect(textarea().style.height).toBe('');
    });

    it('grows the box as the bar goes up and gives the room back as it comes down', () => {
        render(<ChatPromptContent />);

        fireEvent.pointerDown(grip(), { pointerId: 1, clientY: 300 });
        fireEvent.pointerMove(grip(), { pointerId: 1, clientY: 200 });
        expect(textarea().style.height).toBe('158px');

        fireEvent.pointerMove(grip(), { pointerId: 1, clientY: 260 });
        expect(textarea().style.height).toBe('98px');

        // Let go: the pointer moving on afterwards is not a resize.
        fireEvent.pointerUp(grip(), { pointerId: 1 });
        fireEvent.pointerMove(grip(), { pointerId: 1, clientY: 100 });
        expect(textarea().style.height).toBe('98px');
    });

    it('never drags the box down past the point of being one', () => {
        render(<ChatPromptContent />);

        fireEvent.pointerDown(grip(), { pointerId: 1, clientY: 300 });
        fireEvent.pointerMove(grip(), { pointerId: 1, clientY: 900 });

        expect(textarea().style.height).toBe('58px');
    });

    it('answers the arrow keys, so the bar is not a pointer-only control', () => {
        render(<ChatPromptContent />);

        fireEvent.keyDown(grip(), { key: 'ArrowUp' });
        expect(textarea().style.height).toBe('82px');

        fireEvent.keyDown(grip(), { key: 'ArrowDown' });
        expect(textarea().style.height).toBe('58px');
    });
});

describe('ChatPromptContent — a conversation made outside the panel', () => {
    // A flow node played from the board opens a chat nobody typed. It has to land in the switcher
    // like any other, and the record travels with it because the registry frame announcing it may
    // be a moment behind — a switcher asked for a conversation it has not heard of drops it.
    it('adopts the conversation the runner made, and says so', () => {
        state.toShow = { id: 'played-1', title: 'Write the plan', pinned: false };

        render(<ChatPromptContent />);

        expect(state.show).toHaveBeenCalledWith(state.toShow);
        expect(state.shown).toHaveBeenCalledTimes(1);
    });

    it('leaves the switcher alone when nothing is waiting to be shown', () => {
        render(<ChatPromptContent />);

        expect(state.show).not.toHaveBeenCalled();
        expect(state.shown).not.toHaveBeenCalled();
    });
});


// ── Which agent a conversation runs on ────────────────────────────────────────
//
// The one setting the bar carries no control for. A conversation is bound to its agent at creation
// and never changes — a session id belongs to one engine — so the engine is chosen above the
// columns, one starter per agent, and a prompt typed into the empty box runs on the default.

describe('ChatPromptContent — the agent on the prompt bar', () => {
    const agentBox = () => document.querySelector<HTMLElement>('.ant-select[aria-label="Agent"]');

    beforeEach(() => {
        state.conversations = [];
        state.create.mockClear();
    });

    it('draws no agent select — the starters above choose the engine', () => {
        render(<ChatPromptContent />);
        expect(agentBox()).toBeNull();
    });

    it('draws none once the conversation exists either', () => {
        state.conversations = [{
            id: 'conv-a', title: 'Alpha', folder: 'units', agent: 'claude', model: 'haiku',
            effort: 'low', permissionMode: 'manual', thinking: true, running: false,
            archived: false, pinned: false, messageCount: 0, createdAt: '', updatedAt: '',
        }];

        render(<ChatPromptContent />);

        expect(agentBox()).toBeNull();
    });

    it('creates a conversation typed into the empty box on the default agent', async () => {
        render(<ChatPromptContent />);

        fireEvent.change(screen.getByPlaceholderText(/Ask the agent/), { target: { value: 'go' } });
        fireEvent.click(screen.getByRole('button', { name: /send/i }));

        await waitFor(() => expect(state.create).toHaveBeenCalled());
        expect(state.create).toHaveBeenCalledWith(
            expect.objectContaining({ agent: 'claude', folder: 'units' }));
    });
});


// ── The starters above the switcher ───────────────────────────────────────────
//
// One starter per agent the deployment offers. The box below chooses no engine — a prompt typed
// into it makes a conversation on the deployment's default — so without one starter each, a panel
// with a Claude chat in it would have no way left to start a Codex one.

describe('ChatPromptContent — starting a conversation on either agent', () => {
    const starter = (label: string) => screen.getByRole('button', { name: `New ${label} conversation` });

    const CLAUDE_CONVERSATION = {
        id: 'conv-a', title: 'Alpha', folder: 'units', agent: 'claude', model: 'haiku',
        effort: 'low', permissionMode: 'manual', thinking: true, running: false,
        archived: false, pinned: false, messageCount: 0, createdAt: '', updatedAt: '',
    };

    beforeEach(() => {
        state.hasCodex = true;
        state.conversations = [];
    });

    it('offers a starter for every agent this deployment has', () => {
        render(<ChatPromptContent />);

        expect(starter('Claude')).toBeInTheDocument();
        expect(starter('Codex')).toBeInTheDocument();
    });

    it('creates on the agent the starter names, with a chat already open on the other', async () => {
        // The bug this pair of buttons answers: the box names no engine, so the panel could only
        // ever make more of what it was already showing.
        state.conversations = [CLAUDE_CONVERSATION];

        render(<ChatPromptContent />);
        fireEvent.click(starter('Codex'));

        await waitFor(() => expect(state.create).toHaveBeenCalledWith({ folder: 'units', agent: 'codex' }));
        expect(state.codexAuth).toHaveBeenCalledWith('codex');
    });

    // A model, an effort and a mode are the vocabulary of one engine: `haiku` is no model on Codex,
    // and a mode Codex does not publish is a 400 from the service. So they travel with the starter
    // that is the box's own agent, and no further.
    it('hands the box’s settings to its own agent’s starter and to no other', async () => {
        render(<ChatPromptContent />);

        fireEvent.click(starter('Claude'));
        await waitFor(() => expect(state.create).toHaveBeenCalledWith(expect.objectContaining({
            folder: 'units', agent: 'claude', model: 'haiku', effort: 'low',
        })));

        state.create.mockClear();
        fireEvent.click(starter('Codex'));
        await waitFor(() => expect(state.create).toHaveBeenCalledWith({ folder: 'units', agent: 'codex' }));
    });

    it('opens Usage before creating a signed-out Codex conversation', async () => {
        state.codexAuth.mockResolvedValue({ loggedIn: false, loginEnabled: true });
        render(<ChatPromptContent />);
        fireEvent.click(starter('Codex'));
        await waitFor(() => expect(state.showTab).toHaveBeenCalledWith('chat-usage'));
        expect(state.create).not.toHaveBeenCalled();
        expect(state.send).not.toHaveBeenCalled();
    });

    it('waits for Codex auth and allows retry after login', async () => {
        let finish!: (status: { loggedIn: boolean }) => void;
        state.codexAuth.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        render(<ChatPromptContent />);
        fireEvent.click(starter('Codex'));
        fireEvent.click(starter('Codex'));
        expect(state.codexAuth).toHaveBeenCalledTimes(1);
        expect(state.create).not.toHaveBeenCalled();
        await act(async () => { finish({ loggedIn: false }); });
        expect(state.create).not.toHaveBeenCalled();
        state.codexAuth.mockResolvedValue({ loggedIn: true, loginEnabled: true });
        fireEvent.click(starter('Codex'));
        await waitFor(() => expect(state.create).toHaveBeenCalledWith({ folder: 'units', agent: 'codex' }));
    });

    it('does not start when the auth check fails or claim a signed-out account', async () => {
        state.codexAuth.mockRejectedValue(new Error('offline'));
        render(<ChatPromptContent />);
        fireEvent.click(starter('Codex'));
        await waitFor(() => expect(screen.getByText('Could not check Codex sign-in. Try again.')).toBeInTheDocument());
        expect(state.create).not.toHaveBeenCalled();
        expect(state.showTab).not.toHaveBeenCalled();
    });

    it('checks auth before sending in an existing Codex conversation', async () => {
        state.conversations = [{ ...CLAUDE_CONVERSATION, agent: 'codex', permissionMode: 'bypassPermissions' }];
        state.codexAuth.mockResolvedValue({ loggedIn: false, loginEnabled: true });
        render(<ChatPromptContent />);
        fireEvent.change(messageBox(), { target: { value: 'Please update the docs' } });
        fireEvent.click(screen.getByRole('button', { name: /Send$/ }));
        await waitFor(() => expect(state.showTab).toHaveBeenCalledWith('chat-usage'));
        expect(state.send).not.toHaveBeenCalled();
        expect(messageBox()).toHaveValue('Please update the docs');
    });

    it('keeps a draft edited while the Codex auth check is pending', async () => {
        state.conversations = [{ ...CLAUDE_CONVERSATION, agent: 'codex', permissionMode: 'bypassPermissions' }];
        let finish!: (status: { loggedIn: boolean }) => void;
        state.codexAuth.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        render(<ChatPromptContent />);
        fireEvent.change(messageBox(), { target: { value: 'Original message' } });
        fireEvent.click(screen.getByRole('button', { name: /Send$/ }));
        fireEvent.change(messageBox(), { target: { value: 'Edited message' } });
        await act(async () => { finish({ loggedIn: true }); });
        expect(state.send).not.toHaveBeenCalled();
        expect(messageBox()).toHaveValue('Edited message');
    });

    it('offers no starter at all where the machine has no agent CLI', () => {
        state.hasAgents = false;

        render(<ChatPromptContent />);

        expect(screen.queryByRole('button', { name: /New .* conversation/ })).toBeNull();
        expect(screen.getByText(/No agent is enabled and available/)).toBeInTheDocument();
    });
});


// ── The pair the toolbar shows before anything is selected ───────────────────
//
// A new conversation starts on the service's own pair for its agent — `opus` at `max` on Claude,
// the newest Spark contributor build at `max` on Muse — rather than on the cheapest of everything.
// The starter carries what the toolbar shows, so what is pinned here is both ends: the select
// shows the advertised pair, and the conversation the starter makes stores it.

describe('ChatPromptContent — the default a new conversation starts with', () => {
    beforeEach(() => {
        state.claudeEntry = {
            models: [
                { value: 'opus', label: 'Opus' },
                { value: 'haiku', label: 'Haiku' },
            ],
            efforts: [
                { value: 'low', label: 'Low' },
                { value: 'max', label: 'Max' },
            ],
            defaultModel: 'opus',
            defaultEffort: 'max',
        };
        state.conversations = [];
    });

    it('shows the advertised pair in the toolbar', () => {
        render(<ChatPromptContent />);

        expect(screen.getByTitle('Opus · Max')).toBeInTheDocument();
    });

    it('creates the starter’s conversation on it', async () => {
        render(<ChatPromptContent />);

        fireEvent.click(screen.getByRole('button', { name: 'New Claude conversation' }));

        await waitFor(() => expect(state.create).toHaveBeenCalledWith(expect.objectContaining({
            folder: 'units', agent: 'claude', model: 'opus', effort: 'max',
        })));
    });
});

describe('ChatPromptContent — a played task’s model', () => {
    beforeEach(() => {
        state.hasCodex = true;
        state.codexEntry = {
            models: [
                { value: 'gpt-6.1-sol', label: 'Sol 6.1' },
                { value: 'gpt-5.6-sol', label: 'Sol 5' },
            ],
            efforts: [
                { value: 'low', label: 'Low' },
                { value: 'xhigh', label: 'X-High' },
            ],
        };
        state.conversations = [{
            id: 'conv-task', title: 'Played task', folder: 'units', agent: 'codex',
            model: 'gpt-6.1-sol', effort: 'xhigh', permissionMode: 'bypassPermissions',
            thinking: true, pinned: false, archived: false, messageCount: 2,
            createdAt: '', updatedAt: '',
        }];
    });

    const sendFollowUp = async () => {
        fireEvent.change(messageBox(), { target: { value: 'Carry on' } });
        fireEvent.click(screen.getByRole('button', { name: /send/i }));
        await waitFor(() => expect(state.send).toHaveBeenCalledWith('Carry on', expect.objectContaining({
            model: 'gpt-6.1-sol', effort: 'xhigh',
        })));
    };

    it('keeps the conversation’s model while its agent’s options load', async () => {
        state.hasCodex = false;
        const { rerender } = render(<ChatPromptContent />);

        state.hasCodex = true;
        rerender(<ChatPromptContent />);

        expect(screen.getByTitle('Sol 6.1 · X-High')).toBeInTheDocument();
        await sendFollowUp();
    });

    it('keeps and names a stored model absent from the catalogue', async () => {
        state.codexEntry!.models = [{ value: 'gpt-5.6-sol', label: 'Sol 5' }];
        render(<ChatPromptContent />);

        expect(screen.getByTitle('gpt-6.1-sol · X-High')).toBeInTheDocument();
        await sendFollowUp();
    });

    it('shows the captured publication and offers only its model when other models are advertised', () => {
        state.conversations[0] = { ...state.conversations[0], agentVersion: {
            agentId: 'sol', version: 4, name: 'Published Sol', platform: 'codex', model: 'gpt-6.1-sol',
            instructions: 'Keep these orders.', publishedAt: '2026-10-22T12:00:00Z',
        } };
        state.codexEntry!.models = [{ value: 'gpt-5.6-sol', label: 'Other model' }];
        render(<ChatPromptContent />);
        const provenance = screen.getByTestId('conversation-agent-version');
        expect(provenance).toHaveTextContent('Published Sol · v4 · codex · gpt-6.1-sol');
        expect(provenance).toHaveTextContent('Keep these orders.');
        fireEvent.mouseDown(document.querySelector('.chat-model-effort-select .ant-select-content')!);
        expect([...document.querySelectorAll('.chat-select-popup .ant-select-item-option')]
            .every(item => item.textContent?.includes('gpt-6.1-sol'))).toBe(true);
        expect(document.querySelectorAll('.chat-select-popup .ant-select-item-option').length).toBeGreaterThan(0);
    });

    it('keeps the model and effort when the catalogue omits the stored effort', async () => {
        state.codexEntry!.efforts = [{ value: 'low', label: 'Low' }];
        render(<ChatPromptContent />);

        expect(screen.getByTitle('Sol 6.1 · xhigh')).toBeInTheDocument();
        await sendFollowUp();
    });

    it('uses catalogue defaults when a new conversation has no model or effort yet', async () => {
        state.conversations = [{ ...state.conversations[0], model: '', effort: '' }];
        render(<ChatPromptContent />);

        expect(screen.getByTitle('Sol 5 · Low')).toBeInTheDocument();
        fireEvent.change(messageBox(), { target: { value: 'Start the task' } });
        fireEvent.click(screen.getByRole('button', { name: /send/i }));

        await waitFor(() => expect(state.send).toHaveBeenCalledWith('Start the task', expect.objectContaining({
            model: 'gpt-5.6-sol', effort: 'low', permissionMode: 'bypassPermissions',
        })));
    });
});


// ── Where each chat is kept ─────────────────────────────────────────────────────
//
// Every chat heads its transcript with the storage path of its conversation — not the folder the
// conversation runs in, which is a setting of it, but the directory the service keeps it under,
// named by its id. One line per column, inside the scroll.

describe('ChatPromptContent — where each chat is kept', () => {
    const conversation = (overrides: Record<string, unknown> = {}) => ({
        id: 'conv-a', title: 'Alpha', folder: 'units/demo', messageCount: 2, pinned: false,
        ...overrides,
    });

    const storageLines = () => [...document.querySelectorAll('.chat-conversation-storage')];

    it('heads the selected chat with its storage path, inside the scroll', () => {
        state.conversations = [conversation()];
        state.messages = [{ id: 'msg-1', role: 'user', content: 'Hello' }];

        const { container } = render(<ChatPromptContent />);

        const lines = storageLines();
        expect(lines).toHaveLength(1);
        expect(lines[0]).toHaveTextContent('.kiao-config/conversations/conv-a');
        // Inside the scrolled transcript, as its first line — not pinned above it.
        expect(container.querySelector('.chat-messages-area')!.firstElementChild).toBe(lines[0]);
    });

    it('shows nothing where no conversation is selected', () => {
        state.conversations = [];

        render(<ChatPromptContent />);

        expect(storageLines()).toHaveLength(0);
    });

    it('names its own storage in every pinned column', () => {
        state.conversations = [
            conversation({ id: 'conv-a', pinned: true }),
            conversation({ id: 'conv-b' }),
        ];

        render(<ChatPromptContent />);

        expect(storageLines().map(line => line.textContent)).toEqual([
            '.kiao-config/conversations/conv-a',
            '.kiao-config/conversations/conv-b',
        ]);
    });
});
