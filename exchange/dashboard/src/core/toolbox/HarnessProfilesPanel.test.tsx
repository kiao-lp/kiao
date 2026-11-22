import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkerClient, WorkerClientMockProvider } from 'kiao-worker';
import { describe, expect, it, vi } from 'vitest';
import { HarnessProfilesPanel } from './HarnessProfilesPanel';

describe('Pi profile checks', () => {
    it.each(['Check models', 'Test API connection'])('stops %s when the edited profile could not be saved', async button => {
        const client = {
            getHarnessProfiles: vi.fn().mockResolvedValue({
                version: 1, installations: [], availableInstallations: [], profiles: [{
                    id: 'work', name: 'Work', revision: 1, installationId: 'pi', defaultModel: 'provider/model',
                    connections: [{ provider: 'provider', api: 'openai-completions', baseUrl: 'http://localhost/v1', models: [{ id: 'model', reasoning: false }] }],
                    status: 'ready', models: [], secretStates: { provider: true },
                }],
            }),
            getHarnessProfileSecrets: vi.fn().mockResolvedValue([]),
            putHarnessProfiles: vi.fn().mockRejectedValue(new Error('Could not write the profile')),
            diagnoseHarnessProfile: vi.fn(),
            checkHarnessProfileConnection: vi.fn(),
        };
        render(<WorkerClientMockProvider mock={{ workerClient: client as unknown as WorkerClient }}><HarnessProfilesPanel /></WorkerClientMockProvider>);
        const name = await screen.findByLabelText('Profile name', { exact: true });
        await userEvent.type(name, ' edited');
        await userEvent.click(screen.getByRole('button', { name: button }));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Your changes could not be saved'));
        expect(screen.getByText('Could not write the profile')).toBeInTheDocument();
        expect(client.diagnoseHarnessProfile).not.toHaveBeenCalled();
        expect(client.checkHarnessProfileConnection).not.toHaveBeenCalled();
    });

    it('sends the reasoning levels the model declares to Pi', async () => {
        const client = {
            getHarnessProfiles: vi.fn().mockResolvedValue({
                version: 1, installations: [], availableInstallations: [], profiles: [{
                    id: 'work', name: 'Work', revision: 1, installationId: 'pi', defaultModel: 'provider/model',
                    connections: [{ provider: 'provider', api: 'openai-completions', baseUrl: 'http://localhost/v1', models: [{ id: 'model', reasoning: true, thinkingLevelMap: { max: 'max' } }] }],
                    status: 'ready', models: [], secretStates: { provider: true },
                }],
            }),
            getHarnessProfileSecrets: vi.fn().mockResolvedValue([]),
            putHarnessProfiles: vi.fn().mockResolvedValue(undefined),
            diagnoseHarnessProfile: vi.fn(),
            checkHarnessProfileConnection: vi.fn(),
        };
        render(<WorkerClientMockProvider mock={{ workerClient: client as unknown as WorkerClient }}><HarnessProfilesPanel /></WorkerClientMockProvider>);
        await userEvent.click(await screen.findByText('Model capabilities and limits'));
        expect(screen.getByLabelText('Max reasoning 1.1')).toBeChecked();
        expect(screen.getByLabelText('X-High reasoning 1.1')).not.toBeChecked();
        await userEvent.click(screen.getByLabelText('X-High reasoning 1.1'));
        await waitFor(() => expect(client.putHarnessProfiles).toHaveBeenCalled(), { timeout: 3000 });
        const saved = client.putHarnessProfiles.mock.calls.at(-1)?.[0].profiles[0];
        expect(saved.connections[0].models[0].thinkingLevelMap).toEqual({ max: 'max', xhigh: 'xhigh' });
    });
});
