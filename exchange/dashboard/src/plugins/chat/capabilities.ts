// Three hooks, published under the kit's names and reached only through them: the board plays a flow node, reads what the run says.

import { useCallback } from 'react';
import { useToolBars } from '@cms-core';
import type { ChatOptionsCapability, ChatRunCapability, ChatCapability } from '@cms-kit/capabilities';
import { useChatShow } from './ChatShow-ctx';
import { useChatChainRuns } from './ChatChainRuns-ctx';
import { useChatOptionLists } from './useChatOptionLists';
import { CONVERSATIONS_TAB_ID } from './constants';

const useShowChat = (): ((chat: string) => void) => {
    const { showConversation } = useChatShow();
    const toolBars = useToolBars();

    return useCallback((chat: string) => {
        if (!chat) return;
        showConversation(chat);
        toolBars.showTab(CONVERSATIONS_TAB_ID);
    }, [showConversation, toolBars]);
};

const useChatRun = () => {
    const { runs, play: playRun, stop, resume, restart, forget } = useChatChainRuns();
    const toolBars = useToolBars();

    const play = useCallback((path: string, flowNodeId: string, name: string) => {
        toolBars.showTab(CONVERSATIONS_TAB_ID);
        playRun(path, flowNodeId, name);
    }, [playRun, toolBars]);

    return { runs, play, stop, resume: (runId: string) => { void resume(runId); }, restart, forget };
};

// Every agent this deployment offers, the default first, each with the three lists that are its own — because they *are* its own.
const useChatOptions = () => {
    const { agents } = useChatOptionLists();
    return { agents };
};

export const chatCapabilities: {
    'chat.show': ChatCapability;
    'chat.options': ChatOptionsCapability;
    'chat.run': ChatRunCapability;
} = {
    'chat.show': { useShowChat },
    'chat.options': { useChatOptions },
    'chat.run': { useChatRun },
};
