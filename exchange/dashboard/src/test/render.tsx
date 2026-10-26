import React from 'react';
import { render as renderReact, type RenderOptions } from '@testing-library/react';
import { WorkerClientMockProvider, type WorkerClient } from 'kiao-worker';

export * from '@testing-library/react';

interface DashboardRenderOptions extends RenderOptions {
    /** Only the methods used by the rendered tree need to be supplied. No client by default. */
    workerClient?: Partial<WorkerClient>;
}

/** RTL's render, with an optional files client; all controls and other providers stay real. */
export const render = (ui: React.ReactElement, {
    workerClient, wrapper: Wrapper, ...options
}: DashboardRenderOptions = {}) => {
    if (workerClient === undefined) return renderReact(ui, { wrapper: Wrapper, ...options });
    const WithClient = ({ children }: { children: React.ReactNode }) => (
        <WorkerClientMockProvider mock={{ workerClient: workerClient as WorkerClient }}>
            {Wrapper ? <Wrapper>{children}</Wrapper> : children}
        </WorkerClientMockProvider>
    );
    return renderReact(ui, { wrapper: WithClient, ...options });
};
