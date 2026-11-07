// One duty, and it exists because the panel is not always mounted and is never the caller: a board's

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AgentConversation } from 'kiao-worker';
import { useWorkerClient } from '@cms-core';

export interface ChatShowValue {

    toShow: AgentConversation | null;

    shown: () => void;
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
            .catch(error => console.error('Failed to read the conversation to show', conversationId, error));
    }, [client]);

    const value = useMemo<ChatShowValue>(
        () => ({ toShow, shown, showConversation }),
        [toShow, shown, showConversation],
    );

    return <ChatShowContext.Provider value={value}>{children}</ChatShowContext.Provider>;
};
