// ── Putting a conversation on screen from outside the panel ───────────────────
//
// One duty, and it exists because the panel is not always mounted and is never the caller: a board's
// Chat button, and a board opening the conversation a flow node is being played in, both have to
// say "show this one" from somewhere else on the page.
//
// **The record travels rather than the id.** The registry frame announcing a conversation made a
// moment ago may not have reached the switcher yet, and a panel asked to select a conversation it has
// not heard of drops the selection — so the caller's id is read back here, once, and the panel is
// handed the whole record.
//
// This used to be a *runner*: it drove a conversation turn by turn and resolved when the turn ended,
// which is how the board played a chain. That loop is worker's now (see
// `ChatChainRuns-ctx`), and what was left of this is the two lines below — a page that can still
// bring a chat to the front.

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AgentConversation } from 'kiao-worker';
import { useWorkerClient } from '@cms-core';

export interface ChatShowValue {
    /** The conversation the panel is being asked to show, if any. */
    toShow: AgentConversation | null;
    /** Called by the panel once it has shown it. */
    shown: () => void;
    /** Puts a conversation on screen by id. */
    showConversation: (conversationId: string) => void;
}

const ChatShowContext = createContext<ChatShowValue | null>(null);

export const useChatShow = (): ChatShowValue => {
    const ctx = useContext(ChatShowContext);
    if (!ctx) throw new Error('useChatShow must be used within a ChatShowProvider');
    return ctx;
};

export const ChatShowProvider: React.FC<{ children?: ReactNode }> = ({ children }) => {
    const client = useWorkerClient();
    const [toShow, setToShow] = useState<AgentConversation | null>(null);

    const shown = useCallback(() => setToShow(null), []);

    const showConversation = useCallback((conversationId: string) => {
        client.getAgentConversation(conversationId)
            .then(detail => setToShow(detail))
            // Nothing to do about it here: the conversation may have been deleted since the caller
            // wrote its id down, and a panel showing what it was showing is the honest answer.
            .catch(error => console.error('Failed to read the conversation to show', conversationId, error));
    }, [client]);

    const value = useMemo<ChatShowValue>(
        () => ({ toShow, shown, showConversation }),
        [toShow, shown, showConversation],
    );

    return <ChatShowContext.Provider value={value}>{children}</ChatShowContext.Provider>;
};
