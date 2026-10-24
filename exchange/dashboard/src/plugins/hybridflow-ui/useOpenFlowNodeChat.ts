import { useCallback } from 'react';
import { useShowChat } from '@cms-kit/capabilities';

/**
 * No-op for an empty chat or absent chat.show capability; useChatAvailable controls visibility.
 * For card loops, call useShowChat once rather than this hook per card.
 */
export const useOpenFlowNodeChat = (chat: string): (() => void) => {
    const show = useShowChat();
    return useCallback(() => show(chat), [chat, show]);
};
