import React, { createContext, useContext, useMemo } from 'react';
import { useAuthToken } from '@cms-core';
import { HybridflowClient } from './HybridflowClient';

/** Uses same-origin /api/hybridflow unless VITE_HYBRIDFLOW_BASE_URL overrides it. */
const HybridflowClientContext = createContext<HybridflowClient | null>(null);

const baseUrl = (): string => {
    const configured = (import.meta.env.VITE_HYBRIDFLOW_BASE_URL ?? '').trim();
    if (configured) return configured.replace(/\/+$/, '');
    return new URL('/api/hybridflow', window.location.origin).toString().replace(/\/+$/, '');
};

export const HybridflowClientProvider: React.FC<{
    children?: React.ReactNode;
    /** Optional client injection for tests. */
    client?: HybridflowClient;
}> = ({ children, client: given }) => {
    const token = useAuthToken();
    // Read the renewed token per call without rebuilding the client and retriggering consumers.
    const tokenRef = React.useRef(token);
    tokenRef.current = token;
    const built = useMemo(() => new HybridflowClient(baseUrl(), () => tokenRef.current), []);
    const client = given ?? built;
    return <HybridflowClientContext.Provider value={client}>{children}</HybridflowClientContext.Provider>;
};

/** Null without a provider; callers handle unavailable service access. */
export const useHybridflowClient = (): HybridflowClient | null => useContext(HybridflowClientContext);
