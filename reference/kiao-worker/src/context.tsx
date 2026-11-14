import React, { createContext, useContext, ReactNode } from "react";
import { WorkerClient } from "./client";

interface Value {
    workerClient: WorkerClient | null;
}

const Context = createContext<Value>({ workerClient: null });

export const WorkerClientProvider: React.FC<{ workerClient: WorkerClient | null, children: ReactNode }> = ({ workerClient, children }) => {
    return <Context.Provider value={{ workerClient }}>{children}</Context.Provider>;
};

export const WorkerClientMockProvider: React.FC<{ mock: Value, children: ReactNode }> = ({ mock, children }) => {
    return <Context.Provider value={mock}> {children} </Context.Provider>;
};

export const useWorkerClient = () => {
    const settings = useContext(Context);

    if (!settings.workerClient) {
        throw new Error("Please configure a workerClient.");
    }

    return settings.workerClient;
};
