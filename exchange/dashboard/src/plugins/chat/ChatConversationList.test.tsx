import React, { useEffect, useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from 'src/test/render';
import { MockWebSocket } from 'src/test/webSocket';
import type { HarnessConversation, HarnessOptionsEntry, HarnessServerMessage } from 'kiao-worker';

vi.mock('@kiao-dashboard-core', async () => ({ useAuthToken: () => 'tok', Tooltip: (await import('antd')).Tooltip }));

import { ChatSocketProvider, useChatSocketContext } from './ChatSocket-ctx';
import type { ConversationRuntime } from './chatConversationReducer';
import {
    ChatConversationHead, ChatConversationList, ChatConversationRow,
} from './ChatConversationList';

/** What a runtime's turn has said so far. */
const runtimeText = (runtime?: ConversationRuntime) =>
    (runtime?.blocks ?? [])
        .map(block => (block.kind === 'tool_use' ? '' : block.text))
        .join('');


const socket = () => MockWebSocket.instances[MockWebSocket.instances.length - 1];

/** Everything a frame goes through happens in a listener, so every emit moves React state. */
const emit = (msg: HarnessServerMessage) => act(() => { socket().emit(msg); });

const conversation = (id: string, title: string): HarnessConversation => ({
    id,
    title,
    folder: 'units',
    model: 'haiku',
    effort: 'low',
    permissionMode: 'manual',
    harness: 'claude',
    thinking: true,
    running: false,
    archived: false,
    pinned: false,
    messageCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
});

const CONVERSATIONS = [
    conversation('conv-a', 'Alpha'),
    conversation('conv-b', 'Beta'),
    { ...conversation('conv-c', 'Gamma'), pinned: true },
];

const handlers = {
    onRename: vi.fn(),
    onTogglePin: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
};

/**
 * The panel's half of the contract: the conversation being looked at is watched, and watching is.
 * The pinned conversation is not in the select, because in the panel it is not: it heads a column of.
 */
const UNPINNED = CONVERSATIONS.filter(entry => !entry.pinned);

const Panel: React.FC<{ conversations?: HarnessConversation[] }> = ({ conversations = UNPINNED }) => {
    const { runtimes, open } = useChatSocketContext();
    const [activeId, setActiveId] = useState<string | null>('conv-a');

    useEffect(() => {
        if (activeId) open(activeId);
    }, [activeId, open]);

    return (
        <>
            <ChatConversationList
                conversations={conversations}
                activeId={activeId}
                loading={false}
                onSelect={setActiveId}
                {...handlers}
            />
            <ChatConversationRow
                conversation={CONVERSATIONS[2]}
                active={false}
                header
                onSelect={() => { }}
                onRename={title => handlers.onRename('conv-c', title)}
                onTogglePin={() => handlers.onTogglePin('conv-c')}
                onArchive={() => handlers.onArchive('conv-c')}
                onDelete={() => handlers.onDelete('conv-c')}
            />
            <span data-testid="text-conv-a">{runtimeText(runtimes['conv-a'])}</span>
            <span data-testid="text-conv-b">{runtimeText(runtimes['conv-b'])}</span>
        </>
    );
};

const renderPanel = (conversations?: HarnessConversation[]) => {
    render(<ChatSocketProvider><Panel conversations={conversations} /></ChatSocketProvider>);
    act(() => { socket().open(); });
};

/** The switcher's bar: the select, what is running out of sight, and the selected one's actions. */
const bar = (): HTMLElement => document.querySelector('.chat-conversation-list') as HTMLElement;

const header = (): HTMLElement => document.querySelector('.chat-conversation-row--header') as HTMLElement;

const openSelect = () => {
    fireEvent.mouseDown(bar().querySelector('.ant-select-content') as HTMLElement);
};

/** rc-select renders its dropdown in a portal, so an option is found from the document. */
const option = (title: string): HTMLElement =>
    [...document.querySelectorAll<HTMLElement>('.ant-select-item-option')]
        .find(item => item.textContent?.includes(title)) as HTMLElement;

const choose = (title: string) => {
    openSelect();
    fireEvent.click(option(title));
};

beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('ResizeObserver', class {
        observe() { }
        unobserve() { }
        disconnect() { }
    });
});

describe('ChatConversationList', () => {
    it('lights the dot from the runtime map, not from the listed record', () => {
        renderPanel();

        emit({ type: 'sync', permissionMode: 'manual', harness: 'claude', conversationId: 'conv-a', turnId: 't1', running: true, userText: 'go', blocks: [], startedAt: 1 });

        // Both records say `running: false`; the socket is what knows better, and only for the
        expect(bar().querySelector('.chat-conversation-dot--running')).not.toBeNull();

        openSelect();
        expect(option('Alpha').querySelector('.chat-conversation-dot--running')).not.toBeNull();
        expect(option('Beta').querySelector('.chat-conversation-dot--running')).toBeNull();
    });

    it('says nothing about turns when nothing is running', () => {
        renderPanel();
        expect(bar().querySelector('.chat-conversation-running-count')).toBeNull();
    });

    it('counts the conversations running out of sight', () => {
        // The record is what carries it: only the conversations on screen are watched over the
        renderPanel([UNPINNED[0], { ...UNPINNED[1], running: true }]);
        expect(bar().querySelector('.chat-conversation-running-count')).toHaveTextContent('1');

        // The one being looked at is on screen already, so it is never part of the count.
        emit({ type: 'sync', permissionMode: 'manual', harness: 'claude', conversationId: 'conv-a', turnId: 't1', running: true, userText: 'go', blocks: [], startedAt: 1 });
        expect(bar().querySelector('.chat-conversation-running-count')).toHaveTextContent('1');
    });

    it('renames the selected conversation through the patch it is given', () => {
        renderPanel();

        fireEvent.click(within(bar()).getByLabelText('Rename'));
        const box = screen.getByDisplayValue('Alpha');
        fireEvent.change(box, { target: { value: '  Renamed  ' } });
        fireEvent.keyDown(box, { key: 'Enter' });

        expect(handlers.onRename).toHaveBeenCalledWith('conv-a', 'Renamed');
    });

    it('acts on whichever conversation the select is showing', async () => {
        renderPanel();

        choose('Beta');

        fireEvent.click(within(bar()).getByLabelText('Delete'));
        // Deleting drops the transcript with the record, so the click alone must do nothing.
        expect(handlers.onDelete).not.toHaveBeenCalled();

        await screen.findByText('Delete this conversation?');
        const buttons = document.querySelectorAll<HTMLElement>('.ant-popconfirm-buttons button');
        fireEvent.click(buttons[buttons.length - 1]);

        expect(handlers.onDelete).toHaveBeenCalledWith('conv-b');
    });

    it('hangs the confirmation from the button\'s right corner', async () => {
        renderPanel();

        fireEvent.click(within(bar()).getByLabelText('Delete'));
        await screen.findByText('Delete this conversation?');

        expect(document.querySelector('.ant-popover-placement-topRight')).not.toBeNull();
    });

    it('offers to pin the selected conversation and to unpin a pinned one', () => {
        renderPanel();

        fireEvent.click(within(bar()).getByLabelText('Pin'));
        expect(handlers.onTogglePin).toHaveBeenCalledWith('conv-a');

        fireEvent.click(within(header()).getByLabelText('Unpin'));
        expect(handlers.onTogglePin).toHaveBeenCalledWith('conv-c');
    });

    it('offers no fork action, from the list or from a pinned column', () => {
        renderPanel();

        expect(within(bar()).queryByLabelText(/fork/i)).toBeNull();
        expect(within(header()).queryByLabelText(/fork/i)).toBeNull();
    });

    it('keeps accumulating a conversation the panel is no longer showing', () => {
        renderPanel();

        emit({ type: 'start', conversationId: 'conv-a', turnId: 't1', model: 'haiku', effort: 'low', thinking: true, permissionMode: 'manual', harness: 'claude', folder: 'units', startedAt: 1 });
        emit({ type: 'output', conversationId: 'conv-a', turnId: 't1', index: 0, kind: 'text', data: 'one ' });

        choose('Beta');
        emit({ type: 'output', conversationId: 'conv-a', turnId: 't1', index: 0, kind: 'text', data: 'two' });
        emit({ type: 'start', conversationId: 'conv-b', turnId: 't2', model: 'haiku', effort: 'low', thinking: true, permissionMode: 'manual', harness: 'claude', folder: 'units', startedAt: 2 });
        emit({ type: 'output', conversationId: 'conv-b', turnId: 't2', index: 0, kind: 'text', data: 'beta' });

        expect(screen.getByTestId('text-conv-a')).toHaveTextContent('one two');
        expect(screen.getByTestId('text-conv-b')).toHaveTextContent('beta');
    });
});


describe('ChatConversationHead', () => {
    const harness = (value: string, label: string): HarnessOptionsEntry => ({
        value, label, models: [], efforts: [], permissionModes: [],
    });

    const onCreate = vi.fn();

    const starter = (label: string) => screen.getByRole('button', { name: `New ${label} conversation` });

    it('offers one starter per harness, each naming its own', () => {
        render(<ChatConversationHead folder="units" harnesses={[harness('claude', 'Claude'), harness('codex', 'Codex')]} onCreate={onCreate} />);

        fireEvent.click(starter('Codex'));

        expect(onCreate).toHaveBeenCalledWith('codex');

        fireEvent.click(starter('Claude'));
        expect(onCreate).toHaveBeenLastCalledWith('claude');
    });

    it('draws each starter with a mark of its own', () => {
        render(<ChatConversationHead folder="units" harnesses={[harness('claude', 'Claude'), harness('codex', 'Codex')]} onCreate={onCreate} />);

        // Two identical buttons side by side are two buttons nobody can choose between without hovering, and hovering is what the tooltip.
        const mark = (label: string) => starter(label).querySelector('.anticon')?.className;
        expect(mark('Claude')).not.toEqual(mark('Codex'));
    });

    it('offers no starter where the machine has no harness at all', () => {
        render(<ChatConversationHead folder="units" harnesses={[]} onCreate={onCreate} />);

        expect(screen.queryByRole('button')).toBeNull();
    });
});
