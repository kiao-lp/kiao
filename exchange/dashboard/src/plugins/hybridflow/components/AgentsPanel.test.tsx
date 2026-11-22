import React from 'react';
import { ResourceClientProvider, ResourceClient } from '../agentic-resources';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const TEST_ENGINES = vi.hoisted(() => [{
    value: 'claude', label: 'Claude',
    models: [{ value: 'opus', label: 'Opus' }, { value: 'haiku', label: 'Haiku' }],
    efforts: [{ value: 'high', label: 'High' }],
    permissionModes: [{ value: 'bypassPermissions', label: 'Bypass permissions' }],
}]);

vi.mock('../useHarnessOptions', () => ({
    useHarnessOptions: () => ({
        harnesses: TEST_ENGINES,
        optionsFor: () => TEST_ENGINES[0],
    }),
}));

import { CentralStackProvider, CentralStackView } from '@kiao-dashboard-core';
import { AgentsProvider } from '../Agents-ctx';
import { AgentsPanel } from '../agentic-resources/components/AgentsPanel';
import { FakeHybridflowClient } from '../service';
import { readBoardContent } from '../boardContent';

let service: FakeHybridflowClient;

const show = () => render(
    <ResourceClientProvider client={service as unknown as ResourceClient}>
        <AgentsProvider>
            <CentralStackProvider>
                <AgentsPanel />
                <CentralStackView />
            </CentralStackProvider>
        </AgentsProvider>
    </ResourceClientProvider>,
);

const agentOf = (name: string, over: Record<string, unknown> = {}) => ({
    id: `agent-${name}`, name, harness: 'claude', model: 'opus',
    createdAt: '', updatedAt: '', revision: 1, version: '0.0.0', hasUnpublishedChanges: true, ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    service = new FakeHybridflowClient(readBoardContent({ flowNodes: [] }));
});

describe('AgentsPanel', () => {
    it('publishes the typed draft and retains previous published instructions', async () => {
        service.agentsList = [agentOf('Reviewer', { instructions: 'First instructions.' })];
        show();
        fireEvent.click(await screen.findByTestId('edit-agent'));
        const major = screen.getByRole('button', { name: 'Publish major v1.0.0' });
        await waitFor(() => expect(major).toBeEnabled());
        fireEvent.click(major);
        const patch = await screen.findByRole('button', { name: 'Publish patch v1.0.1' });
        expect(patch).toBeDisabled();
        fireEvent.click(patch);
        expect(service.calls.filter(call => call.startsWith('publishAgent'))).toEqual(['publishAgent agent-Reviewer major']);
        const instructions = screen.getByTestId('agent-instructions');
        fireEvent.change(instructions, { target: { value: 'Draft instructions.' } });
        expect(patch).toBeDisabled();
        fireEvent.blur(instructions);
        await waitFor(() => expect(patch).toBeEnabled());
        fireEvent.change(instructions, { target: { value: 'Second instructions.' } });
        fireEvent.click(patch);
        await waitFor(() => expect(service.agentsList[0].published?.version).toBe('1.0.1'));
        expect(service.agentsList[0].published?.instructions).toBe('Second instructions.');
        expect(service.agentHistory.get('agent-Reviewer')?.[0].instructions).toBe('First instructions.');
        expect(service.calls.filter(call => call.startsWith('publishAgent'))).toEqual([
            'publishAgent agent-Reviewer major', 'publishAgent agent-Reviewer patch',
        ]);
    });

    it('lists the agents the service holds, with what each runs on', async () => {
        service.agentsList = [agentOf('Reviewer'), agentOf('Runner', { harness: 'codex' })];
        show();

        await waitFor(() => expect(screen.getAllByTestId('agent-card')).toHaveLength(2));
        expect(screen.getByText('Reviewer')).toBeTruthy();
        expect(screen.getByText('Runner')).toBeTruthy();
        expect(screen.queryByTestId('agent-name')).toBeNull();
        expect(screen.queryByTestId('agent-instructions')).toBeNull();
    });

    it('says so where the store holds none yet', async () => {
        show();

        await waitFor(() => expect(screen.getByText(/Add an agent from/)).toBeTruthy());
    });

    it('says so where no hybridflow store is configured', () => {
        render(
            <CentralStackProvider>
                <AgentsPanel />
            </CentralStackProvider>,
        );

        expect(screen.getByText('Agentic resource manager unavailable')).toBeTruthy();
        expect(screen.queryByTestId('agent-card')).toBeNull();
    });

    it('keeps the description folded until asked, and never shows the instructions there', async () => {
        service.agentsList = [agentOf('Reviewer', {
            description: 'Review code.', instructions: 'Be concise.',
        })];
        show();
        await waitFor(() => expect(screen.getAllByTestId('agent-card')).toHaveLength(1));

        expect(screen.queryByTestId('agent-description-text')).toBeNull();

        fireEvent.click(screen.getByTestId('agent-description-toggle'));
        expect(screen.getByTestId('agent-description-text')).toHaveTextContent('Review code.');
        expect(screen.queryByText('Be concise.')).toBeNull();

        fireEvent.click(screen.getByTestId('agent-description-toggle'));
        expect(screen.queryByTestId('agent-description-text')).toBeNull();
    });

    it('offers no fold where there is no description', async () => {
        service.agentsList = [agentOf('Reviewer')];
        show();
        await waitFor(() => expect(screen.getAllByTestId('agent-card')).toHaveLength(1));

        expect(screen.queryByTestId('agent-description-toggle')).toBeNull();
    });

    it('edits an agent in the central area', async () => {
        service.agentsList = [agentOf('Reviewer', {
            description: 'Review code.', instructions: 'Be concise.',
        })];
        show();
        await waitFor(() => expect(screen.getAllByTestId('agent-card')).toHaveLength(1));

        fireEvent.click(screen.getByTestId('edit-agent'));

        const editor = await screen.findByTestId('agent-editor');
        expect(editor).toBeTruthy();
        expect(screen.getByTestId('central-panel-agent-editor')).toBeTruthy();
        expect(screen.getByTestId('agent-name')).toHaveValue('Reviewer');
        expect(screen.getByTestId('agent-description')).toHaveValue('Review code.');
        expect(screen.getByTestId('agent-instructions')).toHaveValue('Be concise.');
        expect(screen.getByTestId('agent-harness')).toBeTruthy();
        expect(screen.getByTestId('agent-model')).toBeTruthy();
    });

    it('renames an agent from the central editor', async () => {
        service.agentsList = [agentOf('Reviewer')];
        show();
        await waitFor(() => expect(screen.getAllByTestId('agent-card')).toHaveLength(1));

        fireEvent.click(screen.getByTestId('edit-agent'));
        const box = await screen.findByTestId('agent-name');
        fireEvent.change(box, { target: { value: 'Critic' } });
        fireEvent.blur(box);

        await waitFor(() => expect(service.agentsList[0].name).toBe('Critic'));
        expect(service.calls).toContainEqual(expect.stringMatching(/^patchAgent agent-Reviewer name/));
    });

    it('writes the standing instructions from the central editor', async () => {
        service.agentsList = [agentOf('Reviewer')];
        show();
        await waitFor(() => expect(screen.getAllByTestId('agent-card')).toHaveLength(1));

        fireEvent.click(screen.getByTestId('edit-agent'));
        const box = await screen.findByTestId('agent-instructions');
        fireEvent.change(box, { target: { value: 'Be concise.' } });
        fireEvent.blur(box);

        await waitFor(() => expect(service.agentsList[0].instructions).toBe('Be concise.'));
    });

    it('edits and clears selection guidance without changing instructions', async () => {
        service.agentsList = [agentOf('Reviewer', { description: 'Review code.', instructions: 'Be concise.' })];
        show();
        await waitFor(() => expect(screen.getAllByTestId('agent-card')).toHaveLength(1));

        fireEvent.click(screen.getByTestId('edit-agent'));
        const box = await screen.findByTestId('agent-description');
        expect(box).toHaveValue('Review code.');

        for (const description of [' Review Go code. ', '']) {
            fireEvent.change(box, { target: { value: description } });
            fireEvent.blur(box);
            await waitFor(() => expect(service.agentsList[0].description).toBe(description.trim()));
            expect(service.agentsList[0].instructions).toBe('Be concise.');
        }
    });

    it('files the agent the central creator describes', async () => {
        show();
        await waitFor(() => expect(screen.getByText(/Add an agent from/)).toBeTruthy());

        fireEvent.click(screen.getByTestId('new-agent'));
        await screen.findByTestId('agent-creator');
        fireEvent.change(screen.getByTestId('new-agent-name'), { target: { value: 'Reviewer' } });
        fireEvent.change(screen.getByTestId('new-agent-description'), { target: { value: ' Review code. ' } });
        fireEvent.change(screen.getByTestId('new-agent-instructions'), { target: { value: 'Be concise.' } });
        fireEvent.click(screen.getByTestId('create-agent'));

        await waitFor(() => expect(screen.getByText('Reviewer')).toBeTruthy());
        expect(service.calls).toContainEqual(expect.stringMatching(/^createAgent Reviewer/));
        const filed = service.agentsList.find(agent => agent.name === 'Reviewer')!;
        expect(filed.harness).toBe('claude');
        expect(filed.description).toBe('Review code.');
        expect(filed.instructions).toBe('Be concise.');
    });

    // The name is what makes an agent one, and the harness is what it runs on: without both there is nothing to file.
    it('files nothing until the central creator names a name and a harness', async () => {
        show();
        await waitFor(() => expect(screen.getByText(/Add an agent from/)).toBeTruthy());

        fireEvent.click(screen.getByTestId('new-agent'));
        await screen.findByTestId('agent-creator');
        expect(screen.getByTestId('create-agent')).toBeDisabled();

        fireEvent.change(screen.getByTestId('new-agent-name'), { target: { value: 'Reviewer' } });
        expect(screen.getByTestId('create-agent')).toBeEnabled();
    });

    it('deletes an agent that is confirmed', async () => {
        service.agentsList = [agentOf('Reviewer')];
        show();
        await waitFor(() => expect(screen.getAllByTestId('agent-card')).toHaveLength(1));

        fireEvent.click(screen.getByTestId('delete-agent'));
        fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(service.agentsList).toHaveLength(0));
        expect(service.calls).toContainEqual(expect.stringMatching(/^deleteAgent agent-Reviewer/));
    });
});
