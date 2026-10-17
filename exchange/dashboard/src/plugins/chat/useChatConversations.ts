// ── The conversation list ─────────────────────────────────────────────────────
//
// One conversation is a server-side record, not a browser buffer: the list comes from
// `GET /hybridflow-runner/conversations` and stays fresh on the `conversation` / `conversation_deleted` frames,
// which every open socket receives whether or not it subscribed to anything. That is what makes a
// conversation created, renamed or archived in one tab appear in the others without polling.
//
// The active conversation lives in view state rather than in a component, because it is something
// the user expects to find as they left it — after a navigation, after F5, and after the full-page
// OIDC redirect a failed token renewal falls back to.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
    AgentConversation,
    AgentConversationCreate,
    AgentConversationPatch,
} from 'kiao-worker';
import { useWorkerClient, useGlobalViewState } from '@cms-core';
import { useChatSocketContext } from './ChatSocket-ctx';

export interface ChatConversationsState {
    /** Unarchived conversations, most recently updated first. */
    conversations: AgentConversation[];
    activeId: string | null;
    setActiveId: (id: string | null) => void;
    loading: boolean;
    /**
     * Creates a conversation and switches to it. A `404` means the folder is gone, which is answered
     * by choosing another rather than by retrying, so the error is left to the caller.
     */
    create: (body: AgentConversationCreate) => Promise<AgentConversation>;
    /**
     * Takes a conversation made elsewhere into the list and switches to it — what a flow node played
     * from the board arrives as. The record rather than the id, because a switcher asked for
     * a conversation it has not heard of drops the selection; waiting for the registry frame that
     * announces it would show the panel one render of the wrong chat.
     */
    show: (conversation: AgentConversation) => void;
    /**
     * Forks a conversation from one of its messages and switches to the copy. The copy stops *short*
     * of that message: the point of branching at a prompt is to ask that prompt again, differently.
     * Omitting it forks the conversation whole.
     *
     * The original is left exactly as it was, so a failure costs nothing and is left to the caller to
     * say out loud — a `409` is a turn still running in it, which is answered by waiting rather than
     * by retrying.
     */
    fork: (id: string, fromMessageId?: string) => Promise<AgentConversation>;
    /** Renames, archives, or changes the per-turn defaults. An omitted field is left alone. */
    patch: (id: string, body: AgentConversationPatch) => Promise<AgentConversation>;
    /** Deletes a conversation, stopping any turn running in it. */
    remove: (id: string) => Promise<void>;
    refresh: () => void;
}

/** Newest first — the order the service answers in, and the order the switcher shows. */
const byUpdatedAtDesc = (a: AgentConversation, b: AgentConversation): number =>
    b.updatedAt.localeCompare(a.updatedAt);

/**
 * Applies one conversation to the list. Archiving is how a conversation leaves the switcher without
 * being lost, so an archived record is a removal here rather than an update.
 *
 * A record older than the one already held is a late answer rather than news, and is dropped. The
 * same change reaches this list twice — once as the answer to the POST or PATCH that made it, once
 * as the registry frame every socket receives — and nothing orders the two: a `create` whose
 * response arrives after a rename that has already been applied would put the conversation back as
 * it was created. `updatedAt` is stamped by the service on every mutation, so it is the record's
 * version, and comparing it is what makes applying the same change twice harmless in either order.
 */
const upsert = (list: AgentConversation[], conversation: AgentConversation): AgentConversation[] => {
    const held = list.find(entry => entry.id === conversation.id);
    if (held && held.updatedAt > conversation.updatedAt) return list;
    const without = list.filter(entry => entry.id !== conversation.id);
    if (conversation.archived) return without;
    return [...without, conversation].sort(byUpdatedAtDesc);
};

export const useChatConversations = (): ChatConversationsState => {
    const workerClient = useWorkerClient();
    const { onRegistry, close } = useChatSocketContext();
    const [conversations, setConversations] = useState<AgentConversation[]>([]);
    const [loading, setLoading] = useState(true);
    // Whether the list below is the service's answer or the empty one a failed read leaves. The two
    // are the same array and mean opposite things, and the reconciliation is where that matters.
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
        workerClient.listAgentConversations()
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
        // Whatever this tab held of a conversation that no longer exists goes with it.
        close(msg.conversationId);
    }), [onRegistry, close]);

    // An id that no longer names a conversation must not stay active: it is read back from the
    // view-state file at startup, and what it named may have been deleted or archived since. Only
    // an answer justifies dropping it, though — while the list is loading, and after a read that
    // failed, the stored id is all anyone has. Reloading Dashboard during a service restart would
    // otherwise write the loss to the view-state file, where it outlives the outage that caused it.
    useEffect(() => {
        if (loading || !listed || !activeId) return;
        if (!conversations.some(entry => entry.id === activeId)) setActiveId(null);
    }, [loading, listed, activeId, conversations, setActiveId]);

    // The registry broadcast says the same thing to every tab including this one, but applying the
    // record here means the switcher never waits on a frame to show what was just made.
    const show = useCallback((conversation: AgentConversation) => {
        setConversations(prev => upsert(prev, conversation));
        setActiveId(conversation.id);
    }, [setActiveId]);

    const create = useCallback(async (body: AgentConversationCreate) => {
        const created = await workerClient.createAgentConversation(body);
        show(created);
        return created;
    }, [workerClient, show]);

    // A fork is shown the moment it exists, like a conversation made from `+`: it is a copy of what
    // the user is reading, and leaving them on the original would hide the one thing they asked for.
    const fork = useCallback(async (id: string, fromMessageId?: string, agent?: string) => {
        const forked = await workerClient.forkAgentConversation(id, { fromMessageId, agent });
        show(forked);
        return forked;
    }, [workerClient, show]);

    const patch = useCallback(async (id: string, body: AgentConversationPatch) => {
        const updated = await workerClient.patchAgentConversation(id, body);
        setConversations(prev => upsert(prev, updated));
        return updated;
    }, [workerClient]);

    const remove = useCallback(async (id: string) => {
        await workerClient.deleteAgentConversation(id);
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
