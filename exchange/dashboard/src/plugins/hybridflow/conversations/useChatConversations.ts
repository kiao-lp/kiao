// conversation created, renamed or archived in one tab appear in the others without polling.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
    HarnessConversation,
    HarnessConversationCreate,
    HarnessConversationFork,
    HarnessConversationPatch,
} from 'kiao-worker';
import { WorkerError } from 'kiao-worker';
import { useWorkerClient, useGlobalViewState } from '@kiao-dashboard-core';
import { useChatSocketContext } from './ChatSocket-ctx';

export interface ChatConversationsState {
    conversations: HarnessConversation[];
    allConversations: HarnessConversation[];
    activeId: string | null;
    setActiveId: (id: string | null) => void;
    loading: boolean;
    listFailed: boolean;

    create: (body: HarnessConversationCreate) => Promise<HarnessConversation>;

    show: (conversation: HarnessConversation) => void;

    fork: (id: string, body: HarnessConversationFork) => Promise<HarnessConversation>;

    patch: (id: string, body: HarnessConversationPatch) => Promise<HarnessConversation>;

    remove: (id: string) => Promise<void>;
    refresh: () => void;
}

/** Newest first — the order the service answers in, and the order the switcher shows. */
const byUpdatedAtDesc = (a: HarnessConversation, b: HarnessConversation): number =>
    b.updatedAt.localeCompare(a.updatedAt);

const upsert = (list: HarnessConversation[], conversation: HarnessConversation): HarnessConversation[] => {
    const held = list.find(entry => entry.id === conversation.id);
    if (held && held.updatedAt > conversation.updatedAt) return list;
    const without = list.filter(entry => entry.id !== conversation.id);
    return [...without, conversation].sort(byUpdatedAtDesc);
};

export const useChatConversations = (): ChatConversationsState => {
    const workerClient = useWorkerClient();
    const { onRegistry, close } = useChatSocketContext();
    const [allConversations, setAllConversations] = useState<HarnessConversation[]>([]);
    const conversations = useMemo(() => allConversations.filter(entry => !entry.archived), [allConversations]);
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
        workerClient.listHarnessConversations(true)
            .then(list => {
                if (cancelled) return;
                setAllConversations([...list].sort(byUpdatedAtDesc));
                setListed(true);
            })
            .catch(() => {
                if (cancelled) return;
                setAllConversations([]);
                setListed(false);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [workerClient, reloads]);

    useEffect(() => onRegistry(msg => {
        if (msg.type === 'conversation') {
            setAllConversations(prev => upsert(prev, msg.conversation));
            return;
        }
        setAllConversations(prev => prev.filter(entry => entry.id !== msg.conversationId));
        close(msg.conversationId);
    }), [onRegistry, close]);

    // view-state file at startup, and what it named may have been deleted or archived since. otherwise write the loss to the view-state.
    useEffect(() => {
        if (loading || !listed || !activeId) return;
        if (!conversations.some(entry => entry.id === activeId)) setActiveId(null);
    }, [loading, listed, activeId, conversations, setActiveId]);

    // record here means the switcher never waits on a frame to show what was just made.
    const show = useCallback((conversation: HarnessConversation) => {
        setAllConversations(prev => upsert(prev, conversation));
        setActiveId(conversation.id);
    }, [setActiveId]);

    const create = useCallback(async (body: HarnessConversationCreate) => {
        const created = await workerClient.createHarnessConversation(body);
        show(created);
        return created;
    }, [workerClient, show]);

    const fork = useCallback(async (id: string, body: HarnessConversationFork) => {
        const forked = await workerClient.forkHarnessConversation(id, body);
        show(forked);
        return forked;
    }, [workerClient, show]);

    const patch = useCallback(async (id: string, body: HarnessConversationPatch) => {
        const updated = await workerClient.patchHarnessConversation(id, body);
        setAllConversations(prev => prev.some(entry => entry.id === id) ? upsert(prev, updated) : prev);
        return updated;
    }, [workerClient]);

    const remove = useCallback(async (id: string) => {
        try {
            await workerClient.deleteHarnessConversation(id);
        } catch (error) {
            if (!(error instanceof WorkerError) || error.response.status !== 404) throw error;
        }
        setAllConversations(prev => prev.filter(entry => entry.id !== id));
        close(id);
    }, [workerClient, close]);

    const refresh = useCallback(() => setReloads(n => n + 1), []);

    return useMemo(() => ({
        conversations,
        allConversations,
        activeId,
        setActiveId,
        loading,
        listFailed: !loading && !listed,
        create,
        show,
        fork,
        patch,
        remove,
        refresh,
    }), [conversations, allConversations, activeId, setActiveId, loading, listed, create, show, fork, patch, remove, refresh]);
};
