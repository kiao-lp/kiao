// ── What the Conversations panel offers the rest of the assembly ───────────────
//
// Three hooks, published under the kit's names and reached only through them: the board plays a
// flow node, reads what the run says about it, and opens the chat it was played in, without naming this
// plugin — and does none of those things where the assembly holds no chat at all.
//
// The tab id stays private. "Bring up the panel the chat is in" is what a caller means; which tab
// that is, is this plugin's own business. So does the engine: the board asks which agents there are
// and what each one accepts, and never learns that one of them is spawned by a binary called
// `claude`.

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
        // The chat is where a played flow node is watched and answered, so the panel comes up on it.
        toolBars.showTab(CONVERSATIONS_TAB_ID);
        playRun(path, flowNodeId, name);
    }, [playRun, toolBars]);

    return { runs, play, stop, resume: (runId: string) => { void resume(runId); }, restart, forget };
};

// Every agent this deployment offers, the default first, each with the three lists that are its own
// — because they *are* its own, and a card that named a model without naming the engine that model
// belongs to would be a card nobody could read.
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
