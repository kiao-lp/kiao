import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentsProvider, useAgents } from './Agents-ctx';
import { FakeHybridflowClient, HybridflowClientProvider } from './service';
import { readBoardContent } from './boardContent';

let service: FakeHybridflowClient;

beforeEach(() => {
    service = new FakeHybridflowClient(readBoardContent({ flowNodes: [] }));
});

// A board card reads the agents to wear its agent's name, without ever opening the panel.
const CardLikeReader: React.FC = () => {
    const { agents } = useAgents();
    return <>{agents.map(agent => <span key={agent.id}>{agent.name}</span>)}</>;
};

const show = () => render(
    <HybridflowClientProvider client={service.asClient()}>
        <AgentsProvider>
            <CardLikeReader />
        </AgentsProvider>
    </HybridflowClientProvider>,
);

describe('AgentsProvider', () => {
    it('loads the agents for whatever reads them, not only for the panel', async () => {
        service.agentsList = [{
            id: 'agent-1', name: 'Reviewer', platform: 'claude', model: 'opus',
            createdAt: '', updatedAt: '', revision: 1,
        }];
        show();

        await waitFor(() => expect(screen.getByText('Reviewer')).toBeTruthy());
        expect(service.calls).toContain('agents');
    });

    it('reads once for several readers mounting together', async () => {
        service.agentsList = [{
            id: 'agent-1', name: 'Reviewer', platform: 'claude', model: 'opus',
            createdAt: '', updatedAt: '', revision: 1,
        }];
        render(
            <HybridflowClientProvider client={service.asClient()}>
                <AgentsProvider>
                    <CardLikeReader />
                    <CardLikeReader />
                </AgentsProvider>
            </HybridflowClientProvider>,
        );

        await waitFor(() => expect(screen.getAllByText('Reviewer')).toHaveLength(2));
        expect(service.calls.filter(call => call === 'agents')).toHaveLength(1);
    });

    it('answers empty where no provider is mounted, without throwing', () => {
        render(<CardLikeReader />);
        expect(screen.queryByText('Reviewer')).toBeNull();
    });
});
