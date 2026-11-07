import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkerClient, WorkerClientMockProvider } from 'kiao-worker';
import { describe, expect, it, vi } from 'vitest';
import { AgentProfilesPanel } from './AgentProfilesPanel';

describe('Pi profile checks', () => {
    it.each(['Check models', 'Test API connection'])('stops %s when the edited profile could not be saved', async button => {
        const client = {
            getAgentProfiles: vi.fn().mockResolvedValue({
                version: 1, installations: [], availableInstallations: [], profiles: [{
                    id: 'work', name: 'Work', revision: 1, installationId: 'pi', defaultModel: 'provider/model',
                    connections: [{ provider: 'provider', api: 'openai-completions', baseUrl: 'http://localhost/v1', models: [{ id: 'model', reasoning: false }] }],
                    status: 'ready', models: [], secretStates: { provider: true },
                }],
            }),
            getAgentProfileSecrets: vi.fn().mockResolvedValue([]),
            putAgentProfiles: vi.fn().mockRejectedValue(new Error('Could not write the profile')),
            diagnoseAgentProfile: vi.fn(),
            checkAgentProfileConnection: vi.fn(),
        };
        render(<WorkerClientMockProvider mock={{ workerClient: client as unknown as WorkerClient }}><AgentProfilesPanel /></WorkerClientMockProvider>);
        const name = await screen.findByLabelText('Profile name', { exact: true });
        await userEvent.type(name, ' edited');
        await userEvent.click(screen.getByRole('button', { name: button }));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Your changes could not be saved'));
        expect(screen.getByText('Could not write the profile')).toBeInTheDocument();
        expect(client.diagnoseAgentProfile).not.toHaveBeenCalled();
        expect(client.checkAgentProfileConnection).not.toHaveBeenCalled();
    });
});
