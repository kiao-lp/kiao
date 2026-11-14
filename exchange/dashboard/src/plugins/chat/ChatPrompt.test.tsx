import React from 'react';
import { formatLocalDateTime } from '@kiao-dashboard-kit/date-time';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from 'src/test/render';
import type { HarnessPermissionMode, HarnessChainRun } from 'kiao-worker';
import type { PermissionRequest } from './chatMessages';


const { createConversationMock, createConversationsMock } = await vi.hoisted(() => import('./test/mocks'));
const { permissionModes } = await vi.hoisted(() => import('src/test/harnesses'));

const state = vi.hoisted(() => ({
    ...createConversationMock(),
    ...createConversationsMock(),
    socketState: 'open' as 'open' | 'connecting' | 'closed' | 'outdated',
    // because a deployment may withdraw `bypassPermissions` while a conversation created before it
    permissionModes: permissionModes(),
    hasHarnesses: true,
    // Whether it has a *second* one. harness, and because the lists a second engine publishes are its own: `opus` is a Claude model
    hasCodex: false,
    claudeEnabled: true,
    harnessesLoading: false,
    startHarnessLogin: vi.fn(),
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
    runs: [] as HarnessChainRun[],
    stopRun: vi.fn(),
    resumeRun: vi.fn(() => Promise.resolve()),
    auth: { loggedIn: true, loginEnabled: true } as { loggedIn: boolean; loginEnabled: boolean } | null,
    codexAuth: vi.fn(),
    showTab: vi.fn(),
}));

vi.mock('@kiao-dashboard-core', async () => ({
    useStickToBottom: (await import('../../core/ui-foundation/scrolling/useStickToBottom')).useStickToBottom,
    // one's: here the handlers only have to be handlers.
    markdownLinkDropHandlers: () => ({}),
    useFileBrowsingPersistenceContext: () => ({ currentPath: 'units', currentFile: null }),
    useWorkerClient: () => ({ getHarnessAuthStatus: state.codexAuth, startHarnessLogin: state.startHarnessLogin }),
    // The error notice links a signed-out failure to the Usage tab; here the tab switch only has
    useToolBars: () => ({ showTab: state.showTab }),
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
        // The invariant the panel keeps: a pinned conversation has a column of its own, so the main column is never on one.
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
    const harnesses = () => [
        ...(state.claudeEnabled ? [claude()] : []),
        ...(state.hasCodex ? [codex()] : []),
    ];
    return {
        useChatOptionLists: () => ({
            harnesses: state.hasHarnesses ? harnesses() : [],
            defaultHarness: 'claude',
            models: claude().models,
            efforts: claude().efforts,
            permissionModes: state.permissionModes,
            optionsFor: (harness: string) => harnesses().find(entry => entry.value === harness) ?? claude(),
            loading: state.harnessesLoading,
        }),
    };
});

vi.mock('./useChatAuth', () => ({
    useChatAuth: () => ({ status: state.auth, loading: false, refresh: vi.fn() }),
}));

import { ChatPromptContent } from './ChatPrompt';

const textarea = () => screen.getByPlaceholderText(/Ask the harness/) as HTMLTextAreaElement;

/** The box of the main column, whichever of its two jobs it is doing. */
const messageBox = () => screen.getByLabelText(/^Message for/) as HTMLTextAreaElement;

beforeEach(() => {
    vi.clearAllMocks();
    state.socketState = 'open';
    state.hasHarnesses = true;
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
    state.harnessesLoading = false;
    state.patch.mockImplementation(() => Promise.resolve({}));
    state.permissionModes = permissionModes();
    // coordinate the drag reads; only the pointer id has to be put back.
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
        readonly pointerId: number;

        constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 1;
        }
    });
    vi.stubGlobal('ResizeObserver', class {
        observe() { }
        unobserve() { }
        disconnect() { }
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

        expect(screen.getByText(/already running 4 turns/i)).toBeInTheDocument();
    });

    it('lets the notice be waved away', () => {
        state.lastError = { code: 'cli_error', message: 'a tool blew up' };

        render(<ChatPromptContent />);
        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

        expect(screen.queryByText(/a tool blew up/i)).not.toBeInTheDocument();
    });
});


describe('ChatPromptContent — saying something into a running turn', () => {
    const sendButton = () => screen.getByRole('button', { name: /send/i });

    // A conversation is selected throughout: a between is about the turn running in one, and the main column with nothing selected.
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
        // A turn is already running; a prompt would be refused with `conversation_busy` and would never replace it, which is the whole.
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

        state.running = false;
        state.lastError = { code: 'no_running_turn', message: 'That turn had already ended.' };
        rerender(<ChatPromptContent />);

        expect(messageBox()).toHaveValue('stop at ten');
        expect(screen.getByText(/already ended/i)).toBeInTheDocument();
    });
});

// Forking, asked of a message.

describe('ChatPromptContent — forking from a message', () => {
    it('branches at the message and hands its prompt back to the box', async () => {
        state.conversations = [{ id: 'conv-a', title: 'Alpha', folder: 'units', messageCount: 2, pinned: false }];
        state.messages = [{ id: 'msg-7', role: 'user', content: 'Rewrite the README' }];
        render(<ChatPromptContent />);

        fireEvent.click(screen.getByLabelText('Fork conversation from here'));

        await waitFor(() => expect(state.fork).toHaveBeenCalledWith('conv-a', 'msg-7'));
        // The copy stops short of that prompt, so the prompt itself is owed back to a box — and to the *main* one, since a fork is never.
        await waitFor(() => expect(messageBox()).toHaveValue('Rewrite the README'));
    });

    it('withholds the action while a turn is running', () => {
        state.running = true;
        state.conversations = [{ id: 'conv-a', title: 'Alpha', folder: 'units', messageCount: 2, pinned: false }];
        state.messages = [{ id: 'msg-7', role: 'user', content: 'Rewrite the README' }];
        render(<ChatPromptContent />);

        expect(screen.queryByLabelText('Fork conversation from here')).toBeNull();
    });
});

// The sign-in banner.
describe('ChatPromptContent — a host that is not signed in', () => {
    it('keeps the sign-in dialog and code while the harness list is refreshed', async () => {
        state.auth = { loggedIn: false, loginEnabled: true };
        state.startHarnessLogin.mockResolvedValue({ ok: true, url: 'https://auth.example.com/authorize' });
        const { rerender } = render(<ChatPromptContent />);
        fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
        const input = await screen.findByPlaceholderText('Paste the code here');
        fireEvent.change(input, { target: { value: 'code#state' } });

        state.harnessesLoading = true;
        rerender(<ChatPromptContent />);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Paste the code here')).toBe(input);
        expect(input).toHaveValue('code#state');

        state.harnessesLoading = false;
        rerender(<ChatPromptContent />);
        expect(screen.getByPlaceholderText('Paste the code here')).toBe(input);
        expect(input).toHaveValue('code#state');
        expect(state.startHarnessLogin).toHaveBeenCalledTimes(1);
    });

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

    it('disables sending in an existing conversation whose harness was disabled', () => {
        state.hasHarnesses = false;
        state.conversations = [{
            id: 'conv-disabled', harness: 'claude', title: 'Disabled harness', folder: 'units',
            model: 'haiku', effort: 'low', permissionMode: 'manual',
        }];
        render(<ChatPromptContent />);
        fireEvent.change(screen.getByRole('textbox', { name: 'Message for the harness' }), {
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

        await waitFor(() => expect(screen.getByText(/reconnecting/i)).toBeInTheDocument());
    });

    it('says where to install a harness on a machine that has none', async () => {
        state.hasHarnesses = false;

        render(<ChatPromptContent />);

        await waitFor(() =>
            expect(screen.getByText(/No harness is enabled and available/i)).toBeInTheDocument());
        expect(screen.queryByText(/reconnecting/i)).not.toBeInTheDocument();
    });

    it('says nothing before anything has tried to connect', () => {
        state.socketState = 'closed';

        render(<ChatPromptContent />);

        // `closed` is also the transport's state before the first frame asks it to open a socket, and a page that has only just mounted has.
        expect(screen.queryByText(/reconnecting/i)).not.toBeInTheDocument();
    });

    it('gives back the text of a prompt the transport gave up on', () => {
        render(<ChatPromptContent />);

        act(() => { state.droppedListeners.forEach(listener => listener('conv-a', 'do the thing', [])); });

        expect(textarea().value).toBe('do the thing');
    });
});

// What the panel does with the cards a parked turn is waiting on.
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
        expect(state.decidePermission).not.toHaveBeenCalled();
    });

    it('never counts a question down, whatever the turn is running as', () => {
        vi.useFakeTimers();
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

        expect(columns()).toHaveLength(3);
        expect(screen.getAllByPlaceholderText(/Claude|Continue the conversation/)).toHaveLength(3);
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

// The message box's height.
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
    // A flow node played from the board opens a chat nobody typed.
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


// Which harness a conversation runs on.

describe('ChatPromptContent — the harness on the prompt bar', () => {
    const harnessBox = () => document.querySelector<HTMLElement>('.ant-select[aria-label="Harness"]');

    beforeEach(() => {
        state.conversations = [];
        state.create.mockClear();
    });

    it('draws no harness select — the starters above choose the engine', () => {
        render(<ChatPromptContent />);
        expect(harnessBox()).toBeNull();
    });

    it('draws none once the conversation exists either', () => {
        state.conversations = [{
            id: 'conv-a', title: 'Alpha', folder: 'units', harness: 'claude', model: 'haiku',
            effort: 'low', permissionMode: 'manual', thinking: true, running: false,
            archived: false, pinned: false, messageCount: 0, createdAt: '', updatedAt: '',
        }];

        render(<ChatPromptContent />);

        expect(harnessBox()).toBeNull();
    });

    it('creates a conversation typed into the empty box on the default harness', async () => {
        render(<ChatPromptContent />);

        fireEvent.change(screen.getByPlaceholderText(/Ask the harness/), { target: { value: 'go' } });
        fireEvent.click(screen.getByRole('button', { name: /send/i }));

        await waitFor(() => expect(state.create).toHaveBeenCalled());
        expect(state.create).toHaveBeenCalledWith(
            expect.objectContaining({ harness: 'claude', folder: 'units' }));
    });
});


// The starters above the switcher.

describe('ChatPromptContent — starting a conversation on either harness', () => {
    const starter = (label: string) => screen.getByRole('button', { name: `New ${label} conversation` });

    const CLAUDE_CONVERSATION = {
        id: 'conv-a', title: 'Alpha', folder: 'units', harness: 'claude', model: 'haiku',
        effort: 'low', permissionMode: 'manual', thinking: true, running: false,
        archived: false, pinned: false, messageCount: 0, createdAt: '', updatedAt: '',
    };

    beforeEach(() => {
        state.hasCodex = true;
        state.conversations = [];
    });

    it('offers a starter for every harness this deployment has', () => {
        render(<ChatPromptContent />);

        expect(starter('Claude')).toBeInTheDocument();
        expect(starter('Codex')).toBeInTheDocument();
    });

    it('creates on the harness the starter names, with a chat already open on the other', async () => {
        // The bug this pair of buttons answers: the box names no engine, so the panel could only ever make more of what it was already.
        state.conversations = [CLAUDE_CONVERSATION];

        render(<ChatPromptContent />);
        fireEvent.click(starter('Codex'));

        await waitFor(() => expect(state.create).toHaveBeenCalledWith({ folder: 'units', harness: 'codex' }));
        expect(state.codexAuth).toHaveBeenCalledWith('codex');
    });

    it('hands the box’s settings to its own harness’s starter and to no other', async () => {
        render(<ChatPromptContent />);

        fireEvent.click(starter('Claude'));
        await waitFor(() => expect(state.create).toHaveBeenCalledWith(expect.objectContaining({
            folder: 'units', harness: 'claude', model: 'haiku', effort: 'low',
        })));

        state.create.mockClear();
        fireEvent.click(starter('Codex'));
        await waitFor(() => expect(state.create).toHaveBeenCalledWith({ folder: 'units', harness: 'codex' }));
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
        await waitFor(() => expect(state.create).toHaveBeenCalledWith({ folder: 'units', harness: 'codex' }));
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
        state.conversations = [{ ...CLAUDE_CONVERSATION, harness: 'codex', permissionMode: 'bypassPermissions' }];
        state.codexAuth.mockResolvedValue({ loggedIn: false, loginEnabled: true });
        render(<ChatPromptContent />);
        fireEvent.change(messageBox(), { target: { value: 'Please update the docs' } });
        fireEvent.click(screen.getByRole('button', { name: /Send$/ }));
        await waitFor(() => expect(state.showTab).toHaveBeenCalledWith('chat-usage'));
        expect(state.send).not.toHaveBeenCalled();
        expect(messageBox()).toHaveValue('Please update the docs');
    });

    it('keeps a draft edited while the Codex auth check is pending', async () => {
        state.conversations = [{ ...CLAUDE_CONVERSATION, harness: 'codex', permissionMode: 'bypassPermissions' }];
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

    it('offers no starter at all where the machine has no harness CLI', () => {
        state.hasHarnesses = false;

        render(<ChatPromptContent />);

        expect(screen.queryByRole('button', { name: /New .* conversation/ })).toBeNull();
        expect(screen.getByText(/No harness is enabled and available/)).toBeInTheDocument();
    });
});



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
            folder: 'units', harness: 'claude', model: 'opus', effort: 'max',
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
            id: 'conv-task', title: 'Played task', folder: 'units', harness: 'codex',
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

    it('keeps the conversation’s model while its harness’s options load', async () => {
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
            agentId: 'sol', version: 4, name: 'Published Sol', harness: 'codex', model: 'gpt-6.1-sol',
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
