import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { AgentSelect, SuccessCriteriaEditor, NextFlowNodeSelect } from './FlowNodeControls';
import type { SuccessCriterion } from '../boardContent';
import { newFlowNode, BoardContent } from '../boardContent';
import type { FlowNodeSuccess } from '../flowNodeSuccess';

vi.mock('../useHarnessOptions', async () => {
    const { harnessOptions } = await import('src/test/harnesses');
    const harnesses = [
        harnessOptions({ value: 'claude', label: 'Claude', activeModels: ['haiku'] }),
        harnessOptions({
            value: 'codex', label: 'Codex',
            models: ['gpt-sol', 'gpt-astra', 'gpt-terra'].map(value => ({ value, label: value })),
            activeModels: ['gpt-sol', 'gpt-astra'], defaultModel: 'gpt-sol',
        }),
        harnessOptions({ value: 'muse', label: 'Muse', activeModels: ['haiku'] }),
        harnessOptions({
            value: 'pi', label: 'Pi',
            profiles: [{
                id: 'deepseek', name: 'DeepSeek', revision: 1, installationId: 'pi', defaultModel: 'deepseek/flash',
                defaultEffort: 'high', status: 'ready', secretStates: {}, models: [], connections: [],
            }],
        }),
    ];
    return { useHarnessOptions: () => ({
        harnesses, optionsFor: (harness: string) => harnesses.find(entry => entry.value === harness) ?? harnesses[0],
    }) };
});

/** What done means, as it is typed: one box per criterion that starts one row high and grows with what. */

const held = (texts: string[]): SuccessCriterion[] =>
    texts.map((text, index) => ({ id: `criterion-${index}`, text }));

/** The editor over criteria held above it, the way both faces of the task editor hold them. */
const showing = (texts: string[]) => {
    const FlowNodeControlsFixture: React.FC = () => {
        const [criteria, setCriteria] = React.useState<SuccessCriterion[]>(() => held(texts));
        return <SuccessCriteriaEditor criteria={criteria} onChange={setCriteria} />;
    };
    return render(<FlowNodeControlsFixture />);
};

const boxes = () =>
    screen.getAllByLabelText('Success criterion') as HTMLTextAreaElement[];

afterEach(cleanup);

describe('choosing an agent for a task', () => {
    it('lists a unified agent once across active models and profiles', async () => {
        const onChange = vi.fn();
        const agents = [
            { id: 'reviewer', name: 'Reviewer', harness: 'claude', description: 'Review code for correctness.',
                instructions: 'Be concise.', createdAt: '', updatedAt: '', revision: 1 },
            { id: 'writer', name: 'Writer', harness: 'codex', createdAt: '', updatedAt: '', revision: 1 },
        ].map(agent => ({ ...agent, published: { agentId: agent.id, version: '1.0.0', name: agent.name,
            harness: agent.harness, harnesses: agent.id === 'reviewer' ? ['claude', 'codex', 'muse', 'pi'] : undefined,
            supersedes: agent.id === 'reviewer' ? ['writer'] : undefined, model: '', publishedAt: '' } }));
        render(<AgentSelect settings={{}} agents={agents} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Agent' }));

        expect(await screen.findByRole('rowheader', { name: 'Reviewer' })).toBeVisible();
        expect(screen.queryByRole('rowheader', { name: 'Writer' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Reviewer · Muse / haiku' })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Reviewer · Codex / gpt-sol' })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Reviewer · Claude Code / haiku' })).toBeVisible();
        expect(screen.queryByRole('columnheader', { name: 'Codex / gpt-terra' })).toBeNull();
        expect(screen.queryByText('Review code for correctness.')).toBeNull();
        expect(screen.queryByText('Be concise.')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Reviewer · Codex / gpt-astra' }));
        expect(onChange).toHaveBeenCalledWith({ agent: 'reviewer', harness: 'codex', profileId: undefined, model: 'gpt-astra' });
        fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
        fireEvent.click(screen.getByRole('button', { name: 'Reviewer · Pi / DeepSeek' }));
        expect(onChange).toHaveBeenCalledWith({ agent: 'reviewer', harness: 'pi', profileId: 'deepseek', model: undefined });
    });

    it('offers published agents and preserves a missing selected reference', () => {
        const published = { agentId: 'active', version: '1.0.0', name: 'Active', harness: 'claude', model: 'test-model', publishedAt: '' };
        const common = { harness: 'claude', createdAt: '', updatedAt: '', revision: 1 };
        const agents = [{ ...common, id: 'active', name: 'Active', published }, { ...common, id: 'draft', name: 'Draft' }];
        const { rerender } = render(<AgentSelect settings={{}} agents={agents} onChange={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
        expect(screen.getByText('Active')).toBeVisible();
        expect(screen.queryByText('Draft')).toBeNull();
        rerender(<AgentSelect settings={{ agent: 'gone' }} agents={agents} onChange={vi.fn()} />);
        expect(screen.getByTestId('flow-node-agent')).toHaveTextContent('Missing agent · gone');
    });
});

describe('the boxes success criteria are typed in', () => {
    it('shows one multiline box per criterion, wrapping instead of scrolling sideways', () => {
        showing(['It holds', 'It lasts']);
        expect(boxes()).toHaveLength(2);
        for (const box of boxes()) {
            expect(box.tagName).toBe('TEXTAREA');
            expect(box.getAttribute('wrap')).not.toBe('off');
        }
    });

    it('writes every keystroke straight through, like the tags', () => {
        showing(['It holds']);
        fireEvent.change(boxes()[0], { target: { value: 'It holds under load' } });
        expect(boxes()[0].value).toBe('It holds under load');
    });

    it('opens a fresh focused line after the one Enter is pushed in', () => {
        showing(['It holds']);
        fireEvent.keyDown(boxes()[0], { key: 'Enter' });
        expect(boxes()).toHaveLength(2);
        expect(boxes()[0].value).toBe('It holds');
        expect(boxes()[1].value).toBe('');
        expect(document.activeElement).toBe(boxes()[1]);
    });

    it('opens the fresh line after the current one rather than at the end', () => {
        showing(['First', 'Second']);
        fireEvent.keyDown(boxes()[0], { key: 'Enter' });
        expect(boxes().map(box => box.value)).toEqual(['First', '', 'Second']);
        expect(document.activeElement).toBe(boxes()[1]);
    });

    it('focuses the appended line after Add criterion is pushed', () => {
        showing(['It holds']);
        fireEvent.click(screen.getByTestId('flow-node-criteria-add'));
        expect(boxes()).toHaveLength(2);
        expect(boxes()[1].value).toBe('');
        expect(document.activeElement).toBe(boxes()[1]);
    });

    it('drops to the next line of the same criterion on Control+Enter', () => {
        showing(['It holds']);
        const box = boxes()[0];
        box.focus();
        box.setSelectionRange(2, 2);
        fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
        expect(boxes()).toHaveLength(1);
        expect(boxes()[0].value).toBe('It\n holds');
        expect(document.activeElement).toBe(boxes()[0]);
    });
});

describe("a gateway's branches, picked in the panel", () => {
    const showingBranches = (branches: string[]) => {
        const left = { ...newFlowNode('Left'), id: 'left-id' };
        const right = { ...newFlowNode('Right'), id: 'right-id' };
        const join = { ...newFlowNode('Join'), id: 'join-id', type: 'gateway' as const };
        const content: BoardContent = {
            flowNodes: [join, left, right], workflows: [],
        };
        const FlowNodeControlsFixture: React.FC = () => {
            const [success, setSuccess] = React.useState<FlowNodeSuccess>(() => ({
                flowNode: '', flowNodes: branches, mode: 'end', compact: false,
            }));
            return (
                <NextFlowNodeSelect
                    success={success} content={content} flowNodeId="join-id"
                    multiple onChange={setSuccess}
                />
            );
        };
        return render(<FlowNodeControlsFixture />);
    };

    it('shows the branches it holds', () => {
        const shown = showingBranches(['left-id', 'right-id']);
        expect(shown.container.querySelector('.ant-select-multiple')).not.toBeNull();
        expect(screen.getByText('Left')).toBeTruthy();
        expect(screen.getByText('Right')).toBeTruthy();
    });

    it('says where a branch left the board rather than showing an empty box', () => {
        showingBranches(['left-id', 'gone-id']);
        expect(screen.getByText('Left')).toBeTruthy();
        expect(screen.getByText('A node that has left the board')).toBeTruthy();
    });
});
