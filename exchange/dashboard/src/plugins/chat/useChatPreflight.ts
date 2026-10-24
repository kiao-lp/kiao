import { useCallback } from 'react';
import { message } from 'antd';
import { useWorkerClient, useToolBars } from '@cms-core';
import { CHAT_USAGE_TAB_ID } from './constants';

/** Read Codex's host credentials before creating a conversation or starting a turn.
 * Quota reads may spend tokens on other agents, so they are never used as an auth check.
 */
export const useChatPreflight = () => {
    const client = useWorkerClient();
    const toolBars = useToolBars();
    return useCallback(async (agent: string): Promise<boolean> => {
        if (agent !== 'codex') return true;
        try {
            const status = await client.getAgentAuthStatus(agent);
            if (status.loggedIn) return true;
            message.info('Codex is signed out on the server. Log in from Usage to continue.');
            toolBars.showTab(CHAT_USAGE_TAB_ID);
        } catch {
            message.error('Could not check Codex sign-in. Try again.');
        }
        return false;
    }, [client, toolBars]);
};
