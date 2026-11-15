// conversation created, renamed or archived in one tab appear in the others without polling.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
    HarnessConversation,
    HarnessConversationCreate,
    HarnessConversationPatch,
} from 'kiao-worker';
import { useWorkerClient, useGlobalViewState } from '@kiao-dashboard-core';
import { useChatSocketContext } from './ChatSocket-ctx';

export interface ChatConversationsState {
    conversations: HarnessConversation[];
    activeId: string | null;
    setActiveId: (id: string | null) => void;
    loading: boolean;

    create: (body: HarnessConversationCreate) => Promise<HarnessConversation>;

    show: (conversation: HarnessConversation) => void;

    fork: (id: string, fromMessageId?: string, harness?: string, profileId?: string) => Promise<HarnessConversation>;

    patch: (id: string, body: HarnessConversationPatch) => Promise<HarnessConversation>;

    remove: (id: string) => Promise<void>;
    refresh: () => void;
}

/** Newest first — the order the service answers in, and the order the switcher shows. */
const byUpdatedAtDesc = (a: HarnessConversation, b: HarnessConversation): number =>
    b.updatedAt.localeCompare(a.updatedAt);

/**
 * Applies one conversation to the list.
 * Archiving is how a conversation leaves the switcher without being lost, so an archived record is.
 */
const upsert = (list: HarnessConversation[], conversation: HarnessConversation): HarnessConversation[] => {
    const held = list.find(entry => entry.id === conversation.id);
    if (held && held.updatedAt > conversation.updatedAt) return list;
    const without = list.filter(entry => entry.id !== conversation.id);
    if (conversation.archived) return without;
    return [...without, conversation].sort(byUpdatedAtDesc);
};

export const useChatConversations = (): ChatConversationsState => {
    const workerClient = useWorkerClient();
    const { onRegistry, close } = useChatSocketContext();
    const [conversations, setConversations] = useState<HarnessConversation[]>([]);
    const [loading, setLoading] = useState(true);
    const [listed, setListed] = useState(false);
    const [reloads, setReloads] = useState(0);
    const [chatView, setChatView] = useGlobalViewState('chat', {
        activeConversationId: null as string | null,
    });
    const activeId = chatView.activeConversationId;

    const setActiveId = useCallback((id: string | null) => {
        setChatView(prev => ({ ...prev, activeConversationId: id }));
    }, [setChatView]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        workerClient.listHarnessConversations()
            .then(list => {
                if (cancelled) return;
                setConversations([...list].sort(byUpdatedAtDesc));
                setListed(true);
            })
            .catch(() => {
                if (cancelled) return;
                setConversations([]);
                setListed(false);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [workerClient, reloads]);

    useEffect(() => onRegistry(msg => {
        if (msg.type === 'conversation') {
            setConversations(prev => upsert(prev, msg.conversation));
            return;
        }
        setConversations(prev => prev.filter(entry => entry.id !== msg.conversationId));
        close(msg.conversationId);
    }), [onRegistry, close]);

    // view-state file at startup, and what it named may have been deleted or archived since. otherwise write the loss to the view-state.
    useEffect(() => {
        if (loading || !listed || !activeId) return;
        if (!conversations.some(entry => entry.id === activeId)) setActiveId(null);
    }, [loading, listed, activeId, conversations, setActiveId]);

    // record here means the switcher never waits on a frame to show what was just made.
    const show = useCallback((conversation: HarnessConversation) => {
        setConversations(prev => upsert(prev, conversation));
        setActiveId(conversation.id);
    }, [setActiveId]);

    const create = useCallback(async (body: HarnessConversationCreate) => {
        const created = await workerClient.createHarnessConversation(body);
        show(created);
        return created;
    }, [workerClient, show]);

    const fork = useCallback(async (id: string, fromMessageId?: string, harness?: string, profileId?: string) => {
        const forked = await workerClient.forkHarnessConversation(id, { fromMessageId, harness, profileId });
        show(forked);
        return forked;
    }, [workerClient, show]);

    const patch = useCallback(async (id: string, body: HarnessConversationPatch) => {
        const updated = await workerClient.patchHarnessConversation(id, body);
        setConversations(prev => upsert(prev, updated));
        return updated;
    }, [workerClient]);

    const remove = useCallback(async (id: string) => {
        await workerClient.deleteHarnessConversation(id);
        setConversations(prev => prev.filter(entry => entry.id !== id));
        close(id);
    }, [workerClient, close]);

    const refresh = useCallback(() => setReloads(n => n + 1), []);

    return useMemo(() => ({
        conversations,
        activeId,
        setActiveId,
        loading,
        create,
        show,
        fork,
        patch,
        remove,
        refresh,
    }), [conversations, activeId, setActiveId, loading, create, show, fork, patch, remove, refresh]);
};
