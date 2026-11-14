import { useDashboardConfig } from '@kiao-dashboard-core';
import { useChatRunAvailable } from '@kiao-dashboard-kit/capabilities';

/** Board play requires both deployment enablement and a published chat. run capability. */
export const useChatAvailable = (): boolean => {
    const { chatEnabled } = useDashboardConfig();
    return chatEnabled && useChatRunAvailable();
};
