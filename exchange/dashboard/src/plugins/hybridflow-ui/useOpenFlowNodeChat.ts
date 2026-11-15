import { useCallback } from 'react';
import { useShowChat } from '@kiao-dashboard-kit/capabilities';

/** No-op for an empty chat or absent chat. show capability; useChatAvailable controls visibility. */
export const useOpenFlowNodeChat = (chat: string): (() => void) => {
    const show = useShowChat();
    return useCallback(() => show(chat), [chat, show]);
};
