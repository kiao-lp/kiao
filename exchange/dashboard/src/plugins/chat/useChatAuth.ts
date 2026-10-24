import { useCallback, useEffect, useState } from 'react';
import type { AgentAuthStatus } from 'kiao-worker';
import { useWorkerClient } from '@cms-core';

export interface ChatAuthState {
    status: AgentAuthStatus | null;
    /** True while a status read is pending; refreshes retain the previous status. */
    loading: boolean;
    /** Call after sign-in completes. */
    refresh: () => void;
}

/** Each poll spawns `claude auth status`; minutes balance cost with detecting expiry. */
export const CHAT_AUTH_POLL_MS = 5 * 60 * 1000;

/**
 * Tracks the worker host CLI's sign-in status, polling and refreshing on tab visibility
 * to detect expiry. Failed reads retain the last status (initially null): an unreachable
 * service does not imply a signed-out CLI. Disabled Claude clears the status and runs no checks.
 */
export const useChatAuth = (enabled: boolean): ChatAuthState => {
    const [status, setStatus] = useState<AgentAuthStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [reloads, setReloads] = useState(0);
    const workerClient = useWorkerClient();

    const refresh = useCallback(() => setReloads(n => n + 1), []);

    useEffect(() => {
        if (!enabled) {
            setStatus(null);
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        workerClient.getAgentAuthStatus()
            .then(data => {
                if (!cancelled) setStatus(data);
            })
            .catch(() => undefined)
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [workerClient, reloads, enabled]);

    useEffect(() => {
        if (!enabled) return;
        const timer = setInterval(refresh, CHAT_AUTH_POLL_MS);
        const onVisibility = () => {
            if (document.visibilityState === 'visible') refresh();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [refresh, enabled]);

    return { status: enabled ? status : null, loading: enabled && loading, refresh };
};
