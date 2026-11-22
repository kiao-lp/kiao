import React, { createContext, useContext, useMemo, useRef } from 'react';
import { useAuthToken } from '@kiao-dashboard-core';
import { ResourceClient } from './Client';

const Context = createContext<ResourceClient | null>(null);
export const ResourceClientProvider: React.FC<{ children?: React.ReactNode; client?: ResourceClient }> = ({ children, client }) => {
    const token = useAuthToken();
    const current = useRef(token);
    current.current = token;
    const built = useMemo(() => new ResourceClient((import.meta.env.VITE_AGENTIC_RESOURCE_MANAGER_BASE_URL || '/api/agentic').replace(/\/+$/, ''), () => current.current), []);
    return <Context.Provider value={client ?? built}>{children}</Context.Provider>;
};
export const useResourceClient = () => useContext(Context);
