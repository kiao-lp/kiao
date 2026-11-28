import React from 'react';
import { render as renderReact, type RenderOptions } from '@testing-library/react';
import { WorkerClientMockProvider, type WorkerClient } from 'kiao-worker';
import { ConfirmationProvider } from '../core/ui-foundation/forms/ConfirmationDialog';

export * from '@testing-library/react';

interface DashboardRenderOptions extends RenderOptions {
    /** Only the methods used by the rendered tree need to be supplied. */
    workerClient?: Partial<WorkerClient>;
}

/** RTL's render with Dashboard's confirmation host and an optional files client. */
export const render = (ui: React.ReactElement, {
    workerClient, wrapper: Wrapper, ...options
}: DashboardRenderOptions = {}) => {
    const Providers = ({ children }: { children: React.ReactNode }) => {
        const content = Wrapper ? <Wrapper>{children}</Wrapper> : children;
        return (
            <ConfirmationProvider>
                {workerClient === undefined ? content : (
                    <WorkerClientMockProvider mock={{ workerClient: workerClient as WorkerClient }}>
                        {content}
                    </WorkerClientMockProvider>
                )}
            </ConfirmationProvider>
        );
    };
    return renderReact(ui, { wrapper: Providers, ...options });
};
