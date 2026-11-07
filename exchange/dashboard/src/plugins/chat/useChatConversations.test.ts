import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AgentConversation } from 'kiao-worker';

const client = vi.hoisted(() => ({
    listAgentConversations: vi.fn(),
    createAgentConversation: vi.fn(),
    forkAgentConversation: vi.fn(),
    patchAgentConversation: vi.fn(),
    deleteAgentConversation: vi.fn(),
}));

// Nothing here watches a turn; the socket is only the registry feed the list stays live on.
const socket = vi.hoisted(() => ({
    onRegistry: vi.fn((listener: (msg: unknown) => void) => {
        registryListeners.add(listener);
        return () => registryListeners.delete(listener);
    }),
    close: vi.fn(),
}));

/** The registry feed, so a test can push a `conversation` frame the way the socket would. */
const registryListeners = vi.hoisted(() => new Set<(msg: unknown) => void>());

/** Stands in for the view-state file: what a reload reads back is what was last written here. */
const persisted = vi.hoisted(() => ({ chat: null as { activeConversationId: string | null } | null }));

vi.mock('@cms-core', async () => {
    const { useCallback, useState } = await vi.importActual<typeof import('react')>('react');
    return {
        useWorkerClient: () => client,
        useGlobalViewState: (key: string, fallback: { activeConversationId: string | null }) => {
            const [state, setState] = useState(() => (key === 'chat' && persisted.chat ? persisted.chat : fallback));
            const update = useCallback((next: unknown) => {
                setState(prev => {
                    const value = typeof next === 'function' ? next(prev) : next;
                    persisted.chat = value;
                    return value;
                });
            }, []);
            return [state, update];
        },
    };
});

vi.mock('./ChatSocket-ctx', () => ({ useChatSocketContext: () => socket }));

import { useChatConversations } from './useChatConversations';

const conversation = (id: string): AgentConversation => ({
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
    messageCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
});

beforeEach(() => {
    vi.clearAllMocks();
    registryListeners.clear();
    persisted.chat = { activeConversationId: 'conv-a' };
});

describe('useChatConversations — the active conversation', () => {
    it('keeps it when the list could not be read', async () => {
        client.listAgentConversations.mockRejectedValue(new Error('service restarting'));

        const { result } = renderHook(() => useChatConversations());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.activeId).toBe('conv-a');
        expect(persisted.chat?.activeConversationId).toBe('conv-a');
    });

    it('forgets one the list no longer holds', async () => {
        client.listAgentConversations.mockResolvedValue([conversation('conv-b')]);

        const { result } = renderHook(() => useChatConversations());

        await waitFor(() => expect(result.current.activeId).toBeNull());
        expect(persisted.chat?.activeConversationId).toBeNull();
    });
});

// must not undo the other.
describe('useChatConversations — the same change, arriving twice', () => {
    const at = (id: string, title: string, updatedAt: string): AgentConversation =>
        ({ ...conversation(id), title, updatedAt });

    it('ignores a record older than the one it already holds', async () => {
        client.listAgentConversations.mockResolvedValue([]);
        const created = at('conv-a', 'New conversation', '2026-01-01T00:00:01Z');
        client.createAgentConversation.mockResolvedValue(created);

        const { result } = renderHook(() => useChatConversations());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            registryListeners.forEach(listener => listener({
                type: 'conversation',
                conversationId: 'conv-a',
                conversation: at('conv-a', 'Release notes', '2026-01-01T00:00:02Z'),
            }));
        });
        expect(result.current.conversations.map(c => c.title)).toEqual(['Release notes']);

        await act(async () => { await result.current.create({ folder: 'units/demo' }); });

        expect(result.current.conversations.map(c => c.title)).toEqual(['Release notes']);
        expect(result.current.activeId).toBe('conv-a');
    });

    it('still applies a record as new as the one it holds', async () => {
        client.listAgentConversations.mockResolvedValue([at('conv-a', 'Before', '2026-01-01T00:00:01Z')]);

        const { result } = renderHook(() => useChatConversations());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            registryListeners.forEach(listener => listener({
                type: 'conversation',
                conversationId: 'conv-a',
                conversation: at('conv-a', 'After', '2026-01-01T00:00:01Z'),
            }));
        });

        expect(result.current.conversations.map(c => c.title)).toEqual(['After']);
    });
});

describe('useChatConversations — forking', () => {
    it('shows the copy and leaves the original in the list', async () => {
        client.listAgentConversations.mockResolvedValue([conversation('conv-a')]);
        client.forkAgentConversation.mockResolvedValue({
            ...conversation('conv-b'),
            title: 'A conversation (fork)',
            updatedAt: '2026-01-01T00:00:02Z',
        });

        const { result } = renderHook(() => useChatConversations());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => { await result.current.fork('conv-a', 'msg-3'); });

        expect(client.forkAgentConversation).toHaveBeenCalledWith('conv-a', { fromMessageId: 'msg-3', agent: undefined });
        expect(result.current.conversations.map(c => c.id).sort()).toEqual(['conv-a', 'conv-b']);
        expect(result.current.activeId).toBe('conv-b');
    });

    it('leaves a refused fork to the caller, having changed nothing', async () => {
        client.listAgentConversations.mockResolvedValue([conversation('conv-a')]);
        client.forkAgentConversation.mockRejectedValue(new Error('a turn is running'));

        const { result } = renderHook(() => useChatConversations());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await expect(result.current.fork('conv-a')).rejects.toThrow('a turn is running');
        expect(result.current.conversations.map(c => c.id)).toEqual(['conv-a']);
        expect(result.current.activeId).toBe('conv-a');
    });
});
