import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { AgentSelect, SuccessCriteriaEditor, NextFlowNodeSelect } from './FlowNodeControls';
import type { SuccessCriterion } from '../boardContent';
import { newFlowNode, BoardContent } from '../boardContent';
import type { FlowNodeSuccess } from '../flowNodeSuccess';

/**
 * What done means, as it is typed: one box per criterion that starts one row high and grows
 * with what is typed, wrapping instead of scrolling sideways.
 *
 * **Enter** validates the line being typed and opens a fresh one after it, ready to type in;
 * **Control+Enter** drops to the next line inside the same criterion. The *Add criterion* button
 * appends a line the same way, caret and all.
 *
 * The editor is shown the way both faces of the task editor show it — the criteria held above
 * it, every write landing straight through — so a fresh line and its focus are read off the
 * next render, as the board reads them.
 */

const held = (texts: string[]): SuccessCriterion[] =>
    texts.map((text, index) => ({ id: `criterion-${index}`, text }));

/** The editor over criteria held above it, the way both faces of the task editor hold them. */
const showing = (texts: string[]) => {
    const Harness: React.FC = () => {
        const [criteria, setCriteria] = React.useState<SuccessCriterion[]>(() => held(texts));
        return <SuccessCriteriaEditor criteria={criteria} onChange={setCriteria} />;
    };
    return render(<Harness />);
};

const boxes = () =>
    screen.getAllByLabelText('Success criterion') as HTMLTextAreaElement[];

afterEach(cleanup);

describe('choosing an agent for a task', () => {
    it('lists agents by name only and writes only the chosen id', async () => {
        const onChange = vi.fn();
        const agents = [
            { id: 'reviewer', name: 'Reviewer', platform: 'claude', description: 'Review code for correctness.',
                instructions: 'Be concise.', createdAt: '', updatedAt: '', revision: 1 },
            { id: 'writer', name: 'Writer', platform: 'codex', createdAt: '', updatedAt: '', revision: 1 },
        ].map(agent => ({ ...agent, published: { agentId: agent.id, version: 1, name: agent.name,
            platform: agent.platform, model: '', publishedAt: '' } }));
        render(<AgentSelect settings={{}} agents={agents} onChange={onChange} />);
        fireEvent.mouseDown(screen.getByRole('combobox'));

        expect(await screen.findByText('Reviewer')).toBeVisible();
        expect(screen.getByText('Writer')).toBeVisible();
        expect(screen.queryByText('Review code for correctness.')).toBeNull();
        expect(screen.queryByText('Be concise.')).toBeNull();
        fireEvent.click(screen.getByText('Reviewer'));
        expect(onChange).toHaveBeenCalledWith({ agent: 'reviewer', model: undefined });
    });

    it('hides archived and unpublished choices while retaining an archived selection', () => {
        const published = { agentId: 'active', version: 1, name: 'Active', platform: 'claude', model: 'retired-model', publishedAt: '' };
        const common = { platform: 'claude', createdAt: '', updatedAt: '', revision: 1 };
        const agents = [{ ...common, id: 'active', name: 'Active', published },
            { ...common, id: 'archived', name: 'Archived', published, archived: true },
            { ...common, id: 'draft', name: 'Draft' }];
        const { rerender } = render(<AgentSelect settings={{}} agents={agents} onChange={vi.fn()} />);
        fireEvent.mouseDown(screen.getByRole('combobox'));
        expect(screen.getByText('Active')).toBeVisible();
        expect(screen.queryByText('Archived')).toBeNull();
        expect(screen.queryByText('Draft')).toBeNull();
        rerender(<AgentSelect settings={{ agent: 'archived' }} agents={agents} onChange={vi.fn()} />);
        expect(screen.getAllByText('Archived').length).toBeGreaterThan(0);
        expect(document.querySelector('.ant-select-item-option-disabled')).toHaveTextContent('Archived');
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

    // Enter validates the line being typed: the text stays, a fresh line opens after it, and
    // the caret is in the fresh line, ready to type in.
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

    // Control+Enter drops to the next line inside the same criterion: no fresh line, the caret
    // staying where the break was put.
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
            flowNodes: [join, left, right], flowNodeClasses: [], workflows: [], workflowClasses: [],
        };
        const Harness: React.FC = () => {
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
        return render(<Harness />);
    };

    // Several cards at once, each started in parallel when the gateway fires: the select holds
    // the branches, named by title.
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
