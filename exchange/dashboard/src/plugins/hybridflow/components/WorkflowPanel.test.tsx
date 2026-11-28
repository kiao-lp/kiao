import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from 'src/test/render';
import { WorkflowPanel } from './WorkflowPanel';
import { Workflow } from '../boardContent';

const board = vi.hoisted(() => ({
    selectedWorkflowGroup: null as Workflow | null,
    editWorkflow: vi.fn(),
    removeWorkflows: vi.fn(),
    titleCaret: null as string | null,
    takeTitleCaret: vi.fn(),
}));

vi.mock('../Hybridflow-ctx', () => ({
    useHybridflow: () => board,
}));

vi.mock('@kiao-dashboard-kit/code-editor', () => ({
    CodeMirrorJsonEditor: ({ value }: { value: string }) => <textarea aria-label="Workflow values (JSON)" value={value} readOnly />,
}));

const workflowOf = (name: string): Workflow => ({ id: 'w1', name });

const show = (workflow: Workflow) => {
    board.selectedWorkflowGroup = workflow;
    return render(<WorkflowPanel />);
};

beforeEach(() => {
    vi.clearAllMocks();
    board.selectedWorkflowGroup = null;
    board.titleCaret = null;
});

afterEach(() => {
    cleanup();
});

describe('naming a workflow', () => {
    it('renames the open workflow as the name is typed', () => {
        show(workflowOf('Sprint'));

        fireEvent.change(screen.getByTestId('workflow-name'), { target: { value: 'Release' } });

        expect(board.editWorkflow).toHaveBeenCalledWith('w1', 'Release');
    });

    it('shows the workflow values', () => {
        show(workflowOf('Sprint'));
        expect(screen.getByTestId('workflow-panel').textContent).toContain('Workflow');
        expect(screen.getByRole('textbox', { name: 'Workflow values (JSON)' })).toHaveValue('{}');
    });

    it('takes the focus into the name where the rectangle asked for it', () => {
        board.titleCaret = 'w1';
        show(workflowOf(''));

        expect(screen.getByTestId('workflow-name')).toHaveFocus();
        expect(board.takeTitleCaret).toHaveBeenCalled();
    });

    it('asks for a rectangle where none is open', () => {
        render(<WorkflowPanel />);
        expect(screen.queryByTestId('workflow-panel')).toBeNull();
    });
});

describe('deleting a workflow', () => {
    it('asks before taking the open workflow off', async () => {
        show(workflowOf('Sprint'));

        fireEvent.click(screen.getByTestId('delete-workflow'));

        await waitFor(() => expect(document.body.textContent).toContain('Delete the workflow “Sprint”?'));
        expect(board.removeWorkflows).not.toHaveBeenCalled();
    });

    it('takes the open workflow off once confirmed', async () => {
        show(workflowOf('Shapes'));

        fireEvent.click(screen.getByTestId('delete-workflow'));
        const dialog = await screen.findByRole('dialog', { name: 'Delete the workflow “Shapes”?' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete workflow' }));

        await waitFor(() => expect(board.removeWorkflows).toHaveBeenCalledWith(['w1']));
    });
});
