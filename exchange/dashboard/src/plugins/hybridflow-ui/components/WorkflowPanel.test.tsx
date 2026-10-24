import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Modal } from 'antd';
import { WorkflowPanel } from './WorkflowPanel';
import { SelectedWorkflow } from '../Hybridflow-ctx';
import { BoardContent, Workflow, WorkflowClass } from '../boardContent';

/**
 * The open workflow: its name in a box of its own, and nothing else — a name is all a
 * rectangle has. The same panel edits a workflow class, and taking either off ungroups its
 * cards.
 */

const board = vi.hoisted(() => ({
    content: null as BoardContent | null,
    selectedWorkflow: null as SelectedWorkflow | null,
    selectedWorkflowGroup: null as Workflow | WorkflowClass | null,
    editWorkflow: vi.fn(),
    editWorkflowClass: vi.fn(),
    removeWorkflows: vi.fn(),
    removeWorkflowClasses: vi.fn(),
    titleCaret: null as string | null,
    takeTitleCaret: vi.fn(),
}));

vi.mock('../Hybridflow-ctx', () => ({
    useHybridflow: () => board,
}));

const workflowOf = (name: string): Workflow => ({ id: 'w1', name });

const show = (group: Workflow | WorkflowClass, kind: SelectedWorkflow['kind']) => {
    board.content = { flowNodes: [], flowNodeClasses: [], workflows: [], workflowClasses: [] };
    board.selectedWorkflow = { kind, id: group.id };
    board.selectedWorkflowGroup = group;
    return render(<WorkflowPanel />);
};

beforeEach(() => {
    vi.clearAllMocks();
    board.content = null;
    board.selectedWorkflow = null;
    board.selectedWorkflowGroup = null;
    board.titleCaret = null;
});

afterEach(() => {
    cleanup();
    // The confirm portals into document.body, which cleanup does not reach — destroyed rather
    // than left standing in the next test.
    Modal.destroyAll();
});

// A name is all a rectangle has, and the panel is a box for it: typing renames the workflow
// it has open.
describe('naming a workflow', () => {
    it('renames the open workflow as the name is typed', () => {
        show(workflowOf('Sprint'), 'workflow');

        fireEvent.change(screen.getByTestId('workflow-name'), { target: { value: 'Release' } });

        expect(board.editWorkflow).toHaveBeenCalledWith('w1', 'Release');
        expect(board.editWorkflowClass).not.toHaveBeenCalled();
    });

    it('renames the open workflow class through its own call', () => {
        show({ id: 'wc1', name: 'Shapes' }, 'workflowClass');

        fireEvent.change(screen.getByTestId('workflow-name'), { target: { value: 'Forms' } });

        expect(board.editWorkflowClass).toHaveBeenCalledWith('wc1', 'Forms');
        expect(board.editWorkflow).not.toHaveBeenCalled();
    });

    it('says which kind is open', () => {
        show(workflowOf('Sprint'), 'workflow');
        expect(screen.getByTestId('workflow-panel').textContent).toContain('Workflow');
        cleanup();

        show({ id: 'wc1', name: 'Shapes' }, 'workflowClass');
        expect(screen.getByTestId('workflow-panel').textContent).toContain('Workflow class');
    });

    // A rectangle made on the canvas arrives unnamed, and the panel it opens takes the focus
    // into the name — the way a card made on the canvas does.
    it('takes the focus into the name where the rectangle asked for it', () => {
        board.titleCaret = 'w1';
        show(workflowOf(''), 'workflow');

        expect(screen.getByTestId('workflow-name')).toHaveFocus();
        expect(board.takeTitleCaret).toHaveBeenCalled();
    });

    it('asks for a rectangle where none is open', () => {
        render(<WorkflowPanel />);
        expect(screen.queryByTestId('workflow-panel')).toBeNull();
    });
});

// Taking the rectangle off ungroups its cards — and it asks first, the way every delete on
// the board does.
describe('deleting a workflow', () => {
    it('asks before taking the open workflow off', async () => {
        show(workflowOf('Sprint'), 'workflow');

        fireEvent.click(screen.getByTestId('delete-workflow'));

        await waitFor(() => expect(document.body.textContent).toContain('Delete the workflow “Sprint”?'));
        expect(board.removeWorkflows).not.toHaveBeenCalled();
    });

    it('takes the open workflow class off once the ask is answered', async () => {
        show({ id: 'wc1', name: 'Shapes' }, 'workflowClass');

        fireEvent.click(screen.getByTestId('delete-workflow'));
        await waitFor(() => expect(document.body.textContent).toContain('Delete the workflow class “Shapes”?'));
        fireEvent.click(screen.getByText('Delete workflow class'));

        await waitFor(() => expect(board.removeWorkflowClasses).toHaveBeenCalledWith(['wc1']));
    });
});
