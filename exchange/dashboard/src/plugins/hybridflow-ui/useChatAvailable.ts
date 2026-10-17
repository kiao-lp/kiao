import { useDashboardConfig } from '@cms-core';
import { useChatRunAvailable } from '@cms-kit/capabilities';

/** Board play requires both deployment enablement and a published chat.run capability. */
export const useChatAvailable = (): boolean => {
    const { chatEnabled } = useDashboardConfig();
    return chatEnabled && useChatRunAvailable();
};
