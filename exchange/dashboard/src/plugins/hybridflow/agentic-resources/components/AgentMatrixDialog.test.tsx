import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from 'src/test/render';
import type { HarnessOptionsEntry, HarnessProfileOffer } from 'kiao-worker';
import type { AgentDto } from '../types';
import { AgentMatrixDialog } from './AgentMatrixDialog';

const profile = {
    id: 'work', name: 'Work', revision: 1, installationId: 'pi-1', connections: [],
    defaultModel: 'anthropic/claude-sonnet-4', status: 'ready', models: [], secretStates: {},
} as unknown as HarnessProfileOffer;

const pi = {
    value: 'pi', label: 'Pi', models: [], efforts: [], permissionModes: [], profiles: [profile],
} as unknown as HarnessOptionsEntry;

const claude = {
    value: 'claude', label: 'Claude', models: [], efforts: [], permissionModes: [],
    activeModels: ['haiku'], defaultModel: 'haiku',
} as unknown as HarnessOptionsEntry;

const publishedAgent = (id: string, name: string, overrides: Record<string, unknown> = {}): AgentDto => ({
    id, name, harness: 'claude', revision: 1, createdAt: '', updatedAt: '',
    published: {
        agentId: id, name, harness: 'claude', model: 'haiku', version: '1.0.0',
        commit: 'a'.repeat(40), publishedAt: '', ...overrides,
    },
} as unknown as AgentDto);

const agents = [
    publishedAgent('reviewer', 'Reviewer'),
    publishedAgent('pi-agent', 'Pi agent', { harnesses: ['claude', 'pi'], model: undefined, profileId: 'work' }),
];

const renderDialog = (onConfirm = vi.fn()) => render(
    <AgentMatrixDialog
        title="New conversation"
        harnesses={[claude, pi]}
        agents={agents}
        onCancel={() => {}}
        onConfirm={onConfirm}
    />,
);

describe('AgentMatrixDialog', () => {
    it('marks every column choice Select, the header carrying the harness, model or profile', async () => {
        renderDialog();

        expect(await screen.findByRole('button', { name: 'Reviewer · Claude Code / haiku' })).toHaveTextContent('Select');
        // A Pi profile column names its provider model in the header, not in the cell.
        expect(screen.getByRole('button', { name: 'Pi agent · Pi / Work' })).toHaveTextContent('Select');
    });

    it('confirms as soon as a cell is chosen when it has no confirmation button', async () => {
        const onConfirm = vi.fn();
        renderDialog(onConfirm);

        fireEvent.click(await screen.findByRole('button', { name: 'Pi agent · Pi / Work' }));

        expect(onConfirm).toHaveBeenCalledWith({ agent: 'pi-agent', harness: 'pi', profileId: 'work', model: undefined }, false);
        expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    });
});
