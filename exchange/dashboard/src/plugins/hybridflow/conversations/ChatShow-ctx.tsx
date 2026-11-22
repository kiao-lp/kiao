import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { HarnessConversation } from 'kiao-worker';
import { useDashboardConfig, useToolBars, useWorkerClient } from '@kiao-dashboard-core';
import { CONVERSATIONS_TAB_ID } from './constants';

export interface ChatShowValue {

    toShow: HarnessConversation | null;

    shown: () => void;
    showConversation: (conversationId: string) => void;
}

const ChatShowContext = createContext<ChatShowValue | null>(null);

export const useChatShow = (): ChatShowValue => {
    const ctx = useContext(ChatShowContext);
    if (!ctx) throw new Error('useChatShow must be used within a ChatShowProvider');
    return ctx;
};

export const useShowChat = (): ((conversationId: string) => void) => {
    const { showConversation } = useChatShow();
    const { chatEnabled } = useDashboardConfig();
    const { showTab } = useToolBars();
    return useCallback((conversationId: string) => {
        if (!chatEnabled || !conversationId) return;
        showConversation(conversationId);
        showTab(CONVERSATIONS_TAB_ID);
    }, [chatEnabled, showConversation, showTab]);
};

export const ChatShowProvider: React.FC<{ children?: ReactNode }> = ({ children }) => {
    const client = useWorkerClient();
    const [toShow, setToShow] = useState<HarnessConversation | null>(null);

    const shown = useCallback(() => setToShow(null), []);

    const showConversation = useCallback((conversationId: string) => {
        client.getHarnessConversation(conversationId)
            .then(detail => setToShow(detail))
            .catch(error => console.error('Failed to read the conversation to show', conversationId, error));
    }, [client]);

    const value = useMemo<ChatShowValue>(
        () => ({ toShow, shown, showConversation }),
        [toShow, shown, showConversation],
    );

    return <ChatShowContext.Provider value={value}>{children}</ChatShowContext.Provider>;
};
