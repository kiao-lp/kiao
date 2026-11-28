import React from 'react';
import { Modal } from 'antd';
import { formatLocalDateTime } from '@kiao-dashboard-kit/date-time';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from 'src/test/render';
import type { HarnessPermissionMode, HarnessChainRun, HarnessConversationDetail } from 'kiao-worker';
import type { PermissionRequest } from './chatMessages';
import type { AgentDto } from '../agentic-resources/types';


const { createConversationMock, createConversationsMock } = await vi.hoisted(() => import('./test/mocks'));
const { permissionModes } = await vi.hoisted(() => import('src/test/harnesses'));

const state = vi.hoisted(() => ({
    ...createConversationMock(),
    ...createConversationsMock(),
    socketState: 'open' as 'open' | 'connecting' | 'closed' | 'outdated',
    // because a deployment may withdraw `bypassPermissions` while a conversation created before it
    permissionModes: permissionModes(),
    hasHarnesses: true,
    // Codex has its own model, effort and permission options.
    hasCodex: false,
    agents: [] as AgentDto[],
    claudeEnabled: true,
    claudeCanCompact: false,
    harnessesLoading: false,
    transcript: null as HarnessConversationDetail | null,
    startHarnessLogin: vi.fn(),
    claudeEntry: null as null | {
        models: { value: string; label: string }[];
        efforts: { value: string; label: string }[];
    },
    codexEntry: null as null | {
        models: { value: string; label: string }[];
        efforts: { value: string; label: string }[];
    },
    droppedListeners: new Set<(conversationId: string, prompt: string, attachments: string[]) => void>(),
    runs: [] as HarnessChainRun[],
    stopRun: vi.fn(),
    auth: { loggedIn: true, loginEnabled: true } as { loggedIn: boolean; loginEnabled: boolean } | null,
    codexAuth: vi.fn(),
    remove: vi.fn(),
    showTab: vi.fn(),
}));

vi.mock('@kiao-dashboard-core', async () => ({
    AsyncList: (await import('src/core/ui-foundation/feedback/AsyncList')).AsyncList,
    CopyTextButton: (await import('src/core/ui-foundation/clipboard/CopyButton')).CopyTextButton,
    IconButton: (await import('src/core/ui-foundation/toolbar/IconButton')).IconButton,
    ConfirmationDialog: (await import('src/core/ui-foundation/forms/ConfirmationDialog')).ConfirmationDialog,
    useStickToBottom: (await import('src/core/ui-foundation/scrolling/useStickToBottom')).useStickToBottom,
    // one's: here the handlers only have to be handlers.
    markdownLinkDropHandlers: () => ({}),
    useFileBrowsingPersistenceContext: () => ({ currentPath: 'units', currentFile: null }),
    useWorkerClient: () => ({ getHarnessAuthStatus: state.codexAuth, startHarnessLogin: state.startHarnessLogin }),
    // The error notice links a signed-out failure to the Usage tab; here the tab switch only has
    useToolBars: () => ({ showTab: state.showTab }),
    ConfiguredMarkdown: ({ children }: { children: string }) => <div>{children}</div>,
    zoomable: {},
    Tooltip: (await import('antd')).Tooltip,
    InProgressFeedback: (await import('src/core/ui-foundation/feedback/InProgressFeedback')).InProgressFeedback,
    VoiceInputButton: ({ value, onChange }: { value?: string; onChange: (next: string) => void }) => (
        <button type="button" data-testid="voice-input" onClick={() => onChange(value ? `${value} dictated` : 'dictated')}>
            Dictate
        </button>
    ),
}));

vi.mock('./ChatShow-ctx', () => ({
    useChatShow: () => ({ toShow: state.toShow, shown: state.shown }),
}));

vi.mock('./ChatChainRuns-ctx', () => ({
    useChatChainRuns: () => ({
        runs: state.runs, play: vi.fn(), stop: state.stopRun, resume: vi.fn(),
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
        allConversations: state.conversations,
        // The invariant the panel keeps: a pinned conversation has a column of its own, so the main column is never on one.
        activeId: (state.conversations.find(entry => !entry.pinned)?.id as string) ?? null,
        setActiveId: vi.fn(), loading: false,
        create: state.create, show: state.show, fork: state.fork,
        patch: state.patch, remove: state.remove, refresh: vi.fn(), listFailed: false,
    }),
}));

vi.mock('./useChatConversation', () => ({
    useChatConversation: (id: string | null) => ({
        conversation: state.transcript?.id === id ? state.transcript : null,
        messages: state.messages, running: state.running,
        permissionRequests: state.permissionRequests,
        questionRequests: state.questionRequests,
        lastError: state.lastError,
        loading: false,
        send: state.send, sendBetween: state.sendBetween, stop: state.stop,
        decidePermission: state.decidePermission,
        answerQuestions: state.answerQuestions,
    }),
}));

vi.mock('../useHarnessOptions', () => {
    const claude = () => ({
        value: 'claude', label: 'Claude',
        models: state.claudeEntry?.models ?? [{ value: 'haiku', label: 'Haiku' }],
        activeModels: state.claudeEntry?.models.map(model => model.value) ?? ['haiku'],
        efforts: state.claudeEntry?.efforts ?? [{ value: 'low', label: 'Low' }],
        permissionModes: state.permissionModes,
        capabilities: { compact: state.claudeCanCompact },
            });
    const codex = () => ({
        value: 'codex', label: 'Codex',
        models: state.codexEntry?.models ?? [{ value: 'gpt-5', label: 'GPT-5' }],
        activeModels: state.codexEntry?.models.map(model => model.value) ?? ['gpt-5'],
        efforts: state.codexEntry?.efforts ?? [{ value: 'medium', label: 'Medium' }],
        permissionModes: [{ value: 'bypassPermissions', label: 'Bypass permissions' }],
    });
    const harnesses = () => [
        ...(state.claudeEnabled ? [claude()] : []),
        ...(state.hasCodex ? [codex()] : []),
    ];
    return {
        useHarnessOptions: () => ({
            harnesses: state.hasHarnesses ? harnesses() : [],
            defaultHarness: 'claude',
            models: claude().models,
            efforts: claude().efforts,
            permissionModes: state.permissionModes,
            optionsFor: (harness: string) => harnesses().find(entry => entry.value === harness)
                ?? { value: '', label: '', models: [], efforts: [], permissionModes: [] },
            loading: state.harnessesLoading,
        }),
    };
});

vi.mock('../agentic-resources/Agents-ctx', () => ({
    useAgents: () => ({ agents: state.agents, loading: false, error: null }),
}));

vi.mock('./useChatAuth', () => ({
    useChatAuth: () => ({ status: state.auth, loading: false, refresh: vi.fn() }),
}));

import { ChatPromptContent } from './ChatPrompt';

const textarea = () => screen.getByPlaceholderText(/Write a message/) as HTMLTextAreaElement;

const publication = (id: string, name: string, harness: string, model: string) => ({
    agentId: id, name, harness, model, version: '1.0.0', commit: 'a'.repeat(40), publishedAt: '',
});

const reviewer = publication('reviewer', 'Reviewer', 'claude', 'haiku');
const coder = publication('coder', 'Coder', 'codex', 'gpt-5');
const agent = (published: typeof reviewer): AgentDto => ({
    id: published.agentId, name: published.name, harness: published.harness,
    published, revision: 1, createdAt: '', updatedAt: '',
});

const activeConversation = (overrides: Record<string, unknown> = {}) => ({
    id: 'conv-1', title: 'Counting', folder: 'units', harness: 'claude', model: 'haiku', effort: 'low',
    permissionMode: 'manual', thinking: true, running: false, archived: false,
    pinned: false, messageCount: 2, createdAt: '', updatedAt: '', agentVersion: reviewer, ...overrides,
});

const openNew = () => fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
const pickAgent = async (name: string) => {
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${name} · `) }));
};
const confirmFork = () =>
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fork conversation' }));

/** The box of the main column, whichever of its two jobs it is doing. */
const messageBox = () => screen.getByLabelText(/^Message for/) as HTMLTextAreaElement;

const responseTokenLimit = () => screen.getByLabelText(/^Response token limit:/, { selector: 'button' });
const chooseResponseTokenLimit = async (option: string) => {
    fireEvent.click(responseTokenLimit());
    const grid = await screen.findByRole('grid');
    fireEvent.click(within(grid).getByLabelText(option, { selector: 'button' }));
};

beforeEach(() => {
    vi.clearAllMocks();
    state.socketState = 'open';
    state.hasHarnesses = true;
    state.hasCodex = false;
    state.agents = [agent(reviewer), agent(coder)];
    state.claudeEntry = null;
    state.codexEntry = null;
    state.lastError = null;
    state.droppedListeners.clear();
    state.permissionRequests = [];
    state.questionRequests = [];
    state.running = false;
    state.runs = [];
    state.messages = [];
    state.transcript = null;
    state.fork.mockImplementation(() => Promise.resolve({}));
    state.conversations = [];
    state.toShow = null;
    state.auth = { loggedIn: true, loginEnabled: true };
    state.codexAuth.mockResolvedValue({ loggedIn: true, loginEnabled: true });
    state.claudeEnabled = true;
    state.claudeCanCompact = false;
    state.harnessesLoading = false;
    state.patch.mockImplementation(() => Promise.resolve({}));
    state.remove.mockReset().mockResolvedValue(undefined);
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

it('keeps the failed part of a deletion batch selected for retry', async () => {
    state.conversations = [
        activeConversation({ id: 'first', title: 'First conversation' }),
        activeConversation({ id: 'second', title: 'Second conversation' }),
    ];
    state.remove.mockRejectedValueOnce(new Error('service restarting'));
    render(<ChatPromptContent />);

    fireEvent.click(screen.getByRole('button', { name: 'Manage conversations' }));
    const manager = within(screen.getByRole('dialog'));
    const first = manager.getByRole('checkbox', { name: /^First conversation/ });
    const second = manager.getByRole('checkbox', { name: /^Second conversation/ });
    fireEvent.click(first);
    fireEvent.click(second);
    fireEvent.click(manager.getByRole('button', { name: 'Delete' }));
    expect(state.remove).not.toHaveBeenCalled();

    const confirmationTitle = await screen.findByText('Delete 2 conversations?');
    const confirmation = within(confirmationTitle.closest<HTMLElement>('[role="dialog"]')!);
    fireEvent.click(confirmation.getByRole('button', { name: 'Delete' }));
    await manager.findByText('1 conversation deleted. 1 conversation could not be deleted.');

    expect(state.remove.mock.calls).toEqual([['first'], ['second']]);
    expect(first).toBeChecked();
    expect(second).not.toBeChecked();
});

describe('sending a message in the conversation of a suspended run', () => {
    afterEach(() => { act(() => Modal.destroyAll()); });

    it.each([true, false])('sends the message after the resume choice %s', async carryOn => {
        state.conversations = [activeConversation()];
        state.runs = [{
            id: 'run-1', name: 'Review', state: 'suspended', chat: 'conv-1', path: 'board',
            rootFlowNodeId: 'task-1', flowNodeId: 'task-1', startedAt: 1,
        }];
        render(<ChatPromptContent />);

        fireEvent.change(messageBox(), { target: { value: 'Continue the review' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        expect(state.send).not.toHaveBeenCalled();
        fireEvent.click(await screen.findByRole('button', { name: carryOn ? 'Yes, carry on' : 'No, this message only' }));

        await waitFor(() => expect(state.send).toHaveBeenCalledExactlyOnceWith('Continue the review', {
            effort: 'low', permissionMode: 'manual', thinking: true, attachments: [],
            ...(carryOn ? { resumeRunId: 'run-1' } : {}),
        }));
        if (carryOn) expect(state.stopRun).not.toHaveBeenCalled();
        else expect(state.stopRun).toHaveBeenCalledWith('run-1');
    });
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


describe('ChatPromptContent — saying it with the microphone', () => {
    it('puts what was dictated into the message box', () => {
        render(<ChatPromptContent />);

        fireEvent.click(screen.getByTestId('voice-input'));

        expect(textarea()).toHaveValue('dictated');
    });
});

describe('ChatPromptContent — saying something into a running turn', () => {    const sendButton = () => screen.getByRole('button', { name: /send/i });

    // A conversation is selected throughout: a between is about the turn running in one, and the main column with nothing selected.
    beforeEach(() => {
        state.conversations = [activeConversation()];
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

describe('ChatPromptContent — response token limit', () => {
    beforeEach(() => {
        state.conversations = [activeConversation({ sessionId: 'native-session-1' })];
    });

    it('offers None and Fibonacci values multiplied by eight in a 4 by 4 grid', async () => {
        render(<ChatPromptContent />);

        expect(responseTokenLimit()).toHaveAccessibleName('Response token limit: None');
        fireEvent.click(responseTokenLimit());
        const rows = within(await screen.findByRole('grid')).getAllByRole('row');

        expect(rows).toHaveLength(4);
        for (const row of rows) expect(within(row).getAllByRole('gridcell')).toHaveLength(4);
        expect(rows.map(row => within(row).getAllByRole('button').map(button => button.getAttribute('aria-label'))))
            .toEqual([
                ['None', '8', '16', '24'],
                ['40', '64', '104', '168'],
                ['272', '440', '712', '1152'],
                ['1864', '3016', '4880', '7896'],
            ]);
    });

    it('moves focus across the grid with arrows and returns it on Escape', async () => {
        render(<ChatPromptContent />);

        const trigger = responseTokenLimit();
        fireEvent.click(trigger);
        const grid = await screen.findByRole('grid');
        const option = (name: string) => within(grid).getByLabelText(name, { selector: 'button' });
        const none = option('None');
        await waitFor(() => expect(none).toHaveFocus());

        const below = option('40');
        fireEvent.keyDown(none, { key: 'ArrowDown' });
        expect(below).toHaveFocus();
        const next = option('64');
        fireEvent.keyDown(below, { key: 'ArrowRight' });
        expect(next).toHaveFocus();
        expect(Array.from(grid.querySelectorAll('button[tabindex="0"]'))).toEqual([next]);

        fireEvent.keyDown(next, { key: 'Escape' });
        expect(trigger).toHaveFocus();
        expect(trigger).toHaveAccessibleName('Response token limit: None');
    });

    it('sends the selected limit separately from the text and omits it after choosing None', async () => {
        render(<ChatPromptContent />);

        await chooseResponseTokenLimit('40');
        expect(responseTokenLimit()).toHaveAccessibleName('Response token limit: 40 tokens');
        expect(responseTokenLimit()).toHaveTextContent(/^40$/);
        fireEvent.change(messageBox(), { target: { value: 'Review this draft' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));

        const turnOptions = { effort: 'low', permissionMode: 'manual', thinking: true, attachments: [] };
        expect(state.send.mock.calls[0]).toStrictEqual(['Review this draft', { ...turnOptions, responseTokenLimit: '40' }]);

        await chooseResponseTokenLimit('None');
        expect(responseTokenLimit()).toHaveAccessibleName('Response token limit: None');
        fireEvent.change(messageBox(), { target: { value: 'Keep going' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));

        expect(state.send.mock.calls[1]).toStrictEqual(['Keep going', turnOptions]);
    });

    it('omits the limit from Compact and disables the picker during a running turn', async () => {
        state.claudeCanCompact = true;
        const { rerender } = render(<ChatPromptContent />);

        await chooseResponseTokenLimit('40');
        fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
        expect(state.send.mock.calls[0]).toStrictEqual(['/compact', {
            effort: 'low', permissionMode: 'manual', thinking: true,
        }]);

        state.running = true;
        rerender(<ChatPromptContent />);
        expect(responseTokenLimit()).toBeDisabled();
    });
});

// Forking, asked of a message.

describe('ChatPromptContent — forking from a message', () => {
    it('branches at the message and hands its prompt back to the box', async () => {
        state.conversations = [activeConversation({ id: 'conv-a' })];
        state.messages = [{ id: 'msg-7', role: 'user', content: 'Rewrite the README' }];
        render(<ChatPromptContent />);

        fireEvent.click(screen.getByLabelText('Fork conversation from here'));

        confirmFork();
        await waitFor(() => expect(state.fork).toHaveBeenCalledWith('conv-a', { agentId: 'reviewer', harness: 'claude', model: 'haiku', fromMessageId: 'msg-7' }));
        // The copy stops short of that prompt, so the prompt itself is owed back to a box — and to the *main* one, since a fork is never.
        await waitFor(() => expect(messageBox()).toHaveValue('Rewrite the README'));
    });

    it('withholds the action while a turn is running', () => {
        state.running = true;
        state.conversations = [activeConversation({ id: 'conv-a' })];
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
        openNew();
        const reviewerRow = screen.getByRole('rowheader', { name: 'Reviewer' }).closest('tr')!;
        expect(within(reviewerRow).queryByRole('button')).toBeNull();
        expect(screen.getByRole('button', { name: 'Coder · Codex / gpt-5' })).toBeEnabled();
    });

    it('disables sending in an existing conversation whose harness was disabled', () => {
        state.hasHarnesses = false;
        state.conversations = [{
            id: 'conv-disabled', harness: 'claude', title: 'Disabled harness', folder: 'units',
            model: 'haiku', effort: 'low', permissionMode: 'manual',
        }];
        render(<ChatPromptContent />);
        fireEvent.change(screen.getByRole('textbox', { name: 'Message for the agent' }), {
            target: { value: 'Should not send' },
        });
        expect(screen.getByRole('button', { name: /Send$/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Fork with an agent' })).toBeInTheDocument();
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
    const bypassConversation = activeConversation({ permissionMode: 'bypassPermissions' });

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
        state.conversations = [activeConversation({ permissionMode: 'manualLive' })];

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


describe('ChatPromptContent — choosing a published agent', () => {
    it('creates a conversation with the selected agent and the current folder', async () => {
        state.agents.push({ ...agent(reviewer), id: 'draft', name: 'Draft agent', published: undefined });
        state.harnessesLoading = true;
        const { rerender } = render(<ChatPromptContent />);

        openNew();
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
        const dialog = within(screen.getByRole('dialog'));
        expect(dialog.getByRole('status', { name: 'Loading agent and model options' })).toBeVisible();
        expect(dialog.queryByRole('button', { name: 'Create conversation' })).not.toBeInTheDocument();
        expect(dialog.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: /model|execution profile/i })).not.toBeInTheDocument();
        state.harnessesLoading = false;
        rerender(<ChatPromptContent />);
        await pickAgent('Reviewer');
        expect(screen.queryByText('Draft agent', { exact: true })).not.toBeInTheDocument();

        await waitFor(() => expect(state.create).toHaveBeenCalledWith({
            folder: 'units', agentId: 'reviewer', harness: 'claude', model: 'haiku',
        }));
    });

    it.each([
        { limit: undefined, label: 'None' },
        { limit: '40', label: '40 tokens' },
    ])('sends a draft with $label after the agent has been chosen', async ({ limit, label }) => {
        state.create.mockImplementationOnce(async () => {
            const created = activeConversation({ id: 'conv-new' });
            state.conversations = [created];
            return { id: 'conv-new' };
        });
        render(<ChatPromptContent />);
        if (limit) await chooseResponseTokenLimit(limit);
        fireEvent.change(messageBox(), { target: { value: 'Read this draft' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        expect(state.create).not.toHaveBeenCalled();
        await pickAgent('Reviewer');
        await waitFor(() => expect(state.send.mock.calls[0]).toStrictEqual(['Read this draft', {
            attachments: [],
            ...(limit ? { responseTokenLimit: limit } : {}),
        }]));
        expect(responseTokenLimit()).toHaveAccessibleName(`Response token limit: ${label}`);
    });

    it('offers to continue an older transcript with an agent', async () => {
        state.conversations = [activeConversation({ agentVersion: undefined })];
        render(<ChatPromptContent />);

        expect(messageBox()).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Fork with an agent' }));
        await pickAgent('Reviewer');
        confirmFork();
        await waitFor(() => expect(state.fork).toHaveBeenCalledWith('conv-1', { agentId: 'reviewer', harness: 'claude', model: 'haiku' }));
    });

    it('shows the captured agent and sends effort without a model override', async () => {
        state.conversations = [activeConversation({ effort: 'xhigh' })];
        render(<ChatPromptContent />);

        expect(screen.getByTestId('conversation-details').querySelector('summary'))
            .toHaveTextContent('Reviewer · v1.0.0 · Claude · Haiku');
        expect(screen.getByTitle('xhigh')).toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: /model|execution profile/i })).not.toBeInTheDocument();
        fireEvent.change(messageBox(), { target: { value: 'Carry on' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        expect(state.send).toHaveBeenCalledWith('Carry on', {
            effort: 'xhigh', permissionMode: 'manual', thinking: true, attachments: [],
        });
    });
});

describe('ChatPromptContent — Codex host sign-in', () => {
    beforeEach(() => { state.hasCodex = true; });

    it('requires Codex sign-in for the agent and allows retry after login', async () => {
        state.codexAuth.mockResolvedValueOnce({ loggedIn: false });
        render(<ChatPromptContent />);
        openNew();
        await pickAgent('Coder');

        await waitFor(() => expect(state.showTab).toHaveBeenCalledWith('chat-usage'));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(state.create).not.toHaveBeenCalled();

        openNew();
        await pickAgent('Coder');
        await waitFor(() => expect(state.create).toHaveBeenCalledWith({
            folder: 'units', agentId: 'coder', harness: 'codex', model: 'gpt-5',
        }));
    });

    it('keeps the conversation uncreated when the auth check fails', async () => {
        state.codexAuth.mockRejectedValue(new Error('offline'));
        render(<ChatPromptContent />);
        openNew();
        await pickAgent('Coder');
        await waitFor(() => expect(screen.getByText('Could not check Codex sign-in. Try again.')).toBeInTheDocument());
        expect(state.create).not.toHaveBeenCalled();
        expect(state.showTab).not.toHaveBeenCalled();
    });

    it('checks auth before sending in an existing Codex conversation', async () => {
        state.conversations = [activeConversation({ harness: 'codex', permissionMode: 'bypassPermissions', agentVersion: coder })];
        state.codexAuth.mockResolvedValue({ loggedIn: false, loginEnabled: true });
        render(<ChatPromptContent />);
        fireEvent.change(messageBox(), { target: { value: 'Please update the docs' } });
        fireEvent.click(screen.getByRole('button', { name: /Send$/ }));
        await waitFor(() => expect(state.showTab).toHaveBeenCalledWith('chat-usage'));
        expect(state.send).not.toHaveBeenCalled();
        expect(messageBox()).toHaveValue('Please update the docs');
    });

    it('keeps a draft edited while the Codex auth check is pending', async () => {
        state.conversations = [activeConversation({ harness: 'codex', permissionMode: 'bypassPermissions', agentVersion: coder })];
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

});

describe('ChatPromptContent — conversation details', () => {
    it.each(['claude', 'codex', 'muse', 'pi'])('renders %s details at the beginning of the transcript', harness => {
        state.hasCodex = true;
        const active = activeConversation({
            harness, sessionId: 'native-session-7', forkedFrom: 'conv-source', forkedFromMessage: 'msg-source',
        });
        state.conversations = [active];
        state.messages = [{ id: 'msg-1', role: 'user', content: 'Hello' }];
        state.transcript = {
            ...active,
            permissionMode: 'manual',
            locations: {
                conversationDirectory: '/worker-state/conversations/conv-1',
                metadataFile: '/worker-state/conversations/conv-1/meta.json',
                transcriptFile: '/worker-state/conversations/conv-1/transcript.jsonl',
                turnTracesDirectory: '/worker-state/conversations/conv-1/turns',
            },
            messages: [{ id: 'msg-1', role: 'user', text: 'Hello', turnId: 'turn-1', at: '' }],
        };

        const { container } = render(<ChatPromptContent />);

        const details = screen.getByTestId('conversation-details');
        expect(container.querySelector('.chat-messages-area')!.firstElementChild).toBe(details);
        expect(details).not.toHaveAttribute('open');
        details.setAttribute('open', '');
        const panel = within(details);
        expect(panel.getAllByRole('heading').map(heading => heading.textContent)).toEqual([
            'Agent', 'Execution defaults', 'Conversation', 'Files on the worker',
        ]);
        for (const value of [harness, 'native-session-7', 'turn-1', 'conv-source', 'msg-source',
            '/worker-state/conversations/conv-1/transcript.jsonl']) {
            expect(panel.getByText(value, { exact: true })).toBeVisible();
        }
    });

    it('keeps the start hint in the empty pane', () => {
        render(<ChatPromptContent />);

        expect(screen.queryByTestId('conversation-details')).not.toBeInTheDocument();
        expect(screen.getByText(/Choose an agent with New conversation/)).toBeVisible();
    });

    it('shows each column’s conversation ID, including older conversations without an agent snapshot', () => {
        state.conversations = [
            activeConversation({ id: 'conv-a', pinned: true, agentVersion: undefined }),
            activeConversation({ id: 'conv-b' }),
        ];

        render(<ChatPromptContent />);

        const [pinned, main] = screen.getAllByTestId('conversation-details');
        expect(pinned).toHaveTextContent('Agent snapshot unavailable');
        expect(pinned).toHaveTextContent('Conversation IDconv-a');
        expect(main).toHaveTextContent('Conversation IDconv-b');
    });
});
