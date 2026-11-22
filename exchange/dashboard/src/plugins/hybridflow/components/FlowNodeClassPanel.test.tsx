import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from 'src/test/render';
import type { HarnessOptionsEntry } from 'kiao-worker';
import { FlowNodeClassPanel } from './FlowNodeClassPanel';
import { CLASS_VERSION_TEMPLATE_PANEL_ID, ClassVersionTemplatePanel } from './ClassVersionTemplatePanel';
import { FlowNodeClass, FlowNodeClassVersion, newFlowNodeClass } from '../flowNodeClass';
import styles from '../Hybridflow.module.css';

/** The open class's versions: read one by one under the class's own rows, the description filling. */

const board = await vi.hoisted(async () => {
    const { createBoardMock } = await import('../test/mocks');
    return createBoardMock();
});

vi.mock('../Hybridflow-ctx', () => ({
    useHybridflow: () => board,
}));

vi.mock('../Runners-ctx', () => ({
    useRunners: () => ({ runners: [] }),
}));

const TEST_MANAGED = [
    {
        id: 'a1', name: 'Reviewer', harness: 'claude', model: 'opus',
        createdAt: '', updatedAt: '', revision: 1,
    },
    {
        id: 'a2', name: 'Writer', harness: 'codex', harnesses: ['codex', 'pi'], model: '',
        createdAt: '', updatedAt: '', revision: 1,
    },
].map(agent => ({ ...agent, published: { ...agent, agentId: agent.id, version: '1.0.0', publishedAt: '' } }));

vi.mock('../Agents-ctx', () => ({
    useAgents: () => ({ agents: TEST_MANAGED, loading: false, error: null }),
}));

const harnessOptions = vi.hoisted(() => ({
    harnesses: [] as HarnessOptionsEntry[], optionsFor: vi.fn(() => ({ permissionModes: [] })),
}));

vi.mock('../useHarnessOptions', () => ({
    useHarnessOptions: () => harnessOptions,
}));
vi.mock('@kiao-dashboard-kit/capabilities', () => ({
    useTagsUi: () => ({ TagPicker: () => null }),
}));

const centralStack = vi.hoisted(() => ({ push: vi.fn(), close: vi.fn(), panels: [] }));

vi.mock('@kiao-dashboard-core', () => ({
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useFileDrop: () => ({ dropping: false, dropProps: {} }),
    RevealInTreeButton: () => null,
    useCentralStack: () => centralStack,
    VoiceInputButton: ({ value, onChange, disabled }: {
        value?: string; onChange: (next: string) => void; disabled?: boolean;
    }) => disabled ? null : (
        <button type="button" data-testid="voice-input" onClick={() => onChange(`${value} dictated`)}>
            Dictate
        </button>
    ),
}));

const version = (
    id: string, number: number, status: FlowNodeClassVersion['status'], body = '',
    template = false,
): FlowNodeClassVersion => ({ id, number, body, criteria: [], template, status });

const classOf = (
    versions: FlowNodeClassVersion[], type: FlowNodeClass['type'] = 'human',
): FlowNodeClass => ({
    ...newFlowNodeClass(type), id: 'c1', title: 'Review', versions,
});

const show = (flowNodeClass: FlowNodeClass) => {
    board.content = {
        flowNodes: [], flowNodeClasses: [flowNodeClass], workflows: [], workflowClasses: [],
    };
    board.selectedClass = { flowNodeClass, index: 0 };
    return render(<FlowNodeClassPanel />);
};

/** One of the selects. */
const selectBox = (label: string) =>
    document.querySelector<HTMLElement>(`.ant-select[aria-label="${label}"]`)!;

/** Opens a select and takes the choice named. rc-select titles both the box and its options. */
const choose = (label: string, option: string) => {
    fireEvent.mouseDown(selectBox(label).querySelector('.ant-select-content')!);
    fireEvent.click(document.querySelector(`.ant-select-item-option[title="${option}"]`)!);
};

beforeEach(() => {
    board.content = null;
    board.selectedClass = null;
    harnessOptions.harnesses = [];
    vi.clearAllMocks();
});

afterEach(cleanup);

it('sets the harness and profile to copy to new tasks from an AI class', () => {
    harnessOptions.harnesses = [{
        value: 'pi', label: 'Pi', models: [], efforts: [], permissionModes: [], profiles: [{
            id: 'deepseek', name: 'DeepSeek', revision: 1, installationId: 'pi',
            connections: [], defaultModel: 'deepseek/flash', defaultEffort: 'high',
            models: [], secretStates: {}, status: 'ready',
        }],
    }];
    show(classOf([version('v1', 1, 'published', 'Review the diff.')], 'ai'));

    fireEvent.click(screen.getByTestId('flow-node-class-agent'));
    fireEvent.click(screen.getByRole('button', { name: 'Writer · Pi / DeepSeek' }));

    expect(board.editFlowNodeClass).toHaveBeenCalledWith('c1', {
        selection: { agent: 'a2', harness: 'pi', profileId: 'deepseek' },
    });
});

describe('FlowNodeClassPanel versions', () => {
    it('fills the panel with the version description, like a node body', () => {
        show(classOf([version('v1', 1, 'published', 'Read the diff.')]));
        const body = screen.getByTestId('flow-node-class-version-body');
        expect(body.className).toContain(styles.panelVersionBody);
        expect(screen.getByTestId('flow-node-class-versions').className)
            .toContain(styles.panelVersions);
    });

    it('writes a dictated description into the draft as it is spoken', () => {
        show(classOf([version('v1', 1, 'draft', 'Read the diff.')]));
        fireEvent.click(screen.getByTestId('voice-input'));
        expect(board.editClassVersion).toHaveBeenCalledWith('c1', 'v1', {
            body: 'Read the diff. dictated', criteria: [],
        });
    });

    it('offers no dictation over a published version', () => {
        show(classOf([version('v1', 1, 'published', 'Read the diff.')]));
        expect(screen.queryByTestId('voice-input')).toBeNull();
    });

    it('offers no delete on a published version: what stays said stays', () => {
        show(classOf([version('v1', 1, 'published', 'Read the diff.')]));
        expect(screen.queryByTestId('flow-node-class-delete-draft')).toBeNull();
    });

    it('deletes a draft once the confirm is accepted', async () => {
        show(classOf([
            version('v1', 1, 'published', 'Read the diff.'),
            version('v2', 2, 'draft', 'Second thoughts.'),
        ]));
        fireEvent.click(screen.getByTestId('flow-node-class-delete-draft'));
        const title = await screen.findByText('Delete draft v2?', { selector: '.ant-modal-confirm-title' });
        const confirm = title.closest('.ant-modal-confirm') as HTMLElement;
        const accept = [...confirm.querySelectorAll('button')]
            .find(button => button.textContent === 'Delete draft') as HTMLElement;
        fireEvent.click(accept);
        expect(board.deleteClassVersion).toHaveBeenCalledWith('c1', 'v2');
    });

    it('keeps a draft where the confirm is refused', async () => {
        show(classOf([version('v1', 1, 'draft', 'Second thoughts.')]));
        fireEvent.click(screen.getByTestId('flow-node-class-delete-draft'));
        const title = await screen.findByText('Delete draft v1?', { selector: '.ant-modal-confirm-title' });
        const confirm = title.closest('.ant-modal-confirm') as HTMLElement;
        const keep = [...confirm.querySelectorAll('button')]
            .find(button => button.textContent === 'Keep it') as HTMLElement;
        fireEvent.click(keep);
        expect(board.deleteClassVersion).not.toHaveBeenCalled();
    });

    it('ticks the template mode on a draft, like the words', () => {
        show(classOf([version('v1', 1, 'draft', 'Read ${what:text}.')]));
        const box = screen.getByTestId('flow-node-class-version-template');
        expect(box).not.toBeChecked();
        fireEvent.click(box);
        expect(board.editClassVersion).toHaveBeenCalledWith('c1', 'v1', { template: true });
    });

    it('unticks the template mode it shows as ticked', () => {
        show(classOf([version('v1', 1, 'draft', 'Read ${what:text}.', true)]));
        const box = screen.getByTestId('flow-node-class-version-template');
        expect(box).toBeChecked();
        fireEvent.click(box);
        expect(board.editClassVersion).toHaveBeenCalledWith('c1', 'v1', { template: false });
    });

    it('shows the template mode as it was left on a published version, and asks nothing', () => {
        show(classOf([version('v1', 1, 'published', 'Read ${what:text}.', true)]));
        const box = screen.getByTestId('flow-node-class-version-template');
        expect(box).toBeChecked();
        expect(box).toBeDisabled();
    });

    it('opens the version template in the document panel from the button left of the checkbox', () => {
        show(classOf([version('v1', 1, 'draft', 'Read ${what:text}.', true)]));
        const button = screen.getByTestId('flow-node-class-version-edit-template');
        const box = screen.getByTestId('flow-node-class-version-template');
        expect(button).not.toBeDisabled();
        expect(button.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        fireEvent.click(button);

        expect(centralStack.push).toHaveBeenCalledTimes(1);
        const pushed = centralStack.push.mock.calls[0][0];
        expect(pushed.id).toBe(CLASS_VERSION_TEMPLATE_PANEL_ID);
        expect(pushed.title).toContain('Review');
        expect(pushed.title).toContain('v1');
        expect(pushed.content.type).toBe(ClassVersionTemplatePanel);
        expect(pushed.content.props).toMatchObject({ classId: 'c1', versionId: 'v1' });
    });

    it('offers no template editor on a plain body: it is edited in the box below', () => {
        show(classOf([version('v1', 1, 'draft', 'Read the diff.')]));
        expect(screen.getByTestId('flow-node-class-version-edit-template')).toBeDisabled();
    });

    it('offers no template editor on a published version: what stays said stays', () => {
        show(classOf([version('v1', 1, 'published', 'Read ${what:text}.', true)]));
        expect(screen.getByTestId('flow-node-class-version-edit-template')).toBeDisabled();
    });
});

describe('FlowNodeClassPanel note', () => {
    it('edits the note from the header button', () => {
        const one = classOf([version('v1', 1, 'draft', 'Read the diff.')]);
        one.note = 'When the diff is ready.';
        show(one);
        fireEvent.click(screen.getByTestId('edit-flow-node-class-note'));
        const body = screen.getByTestId('flow-node-class-note-body') as HTMLTextAreaElement;
        expect(body.value).toBe('When the diff is ready.');
        fireEvent.change(body, { target: { value: 'When the diff is merged.' } });
        fireEvent.click(screen.getByText('Save note'));
        expect(board.editFlowNodeClass).toHaveBeenCalledWith('c1', { note: 'When the diff is merged.' });
        expect(screen.queryByTestId('flow-node-class-note-body')).toBeNull();
    });

    it('keeps the note where the dialog is cancelled', () => {
        const one = classOf([version('v1', 1, 'draft', 'Read the diff.')]);
        one.note = 'When the diff is ready.';
        show(one);
        fireEvent.click(screen.getByTestId('edit-flow-node-class-note'));
        fireEvent.change(screen.getByTestId('flow-node-class-note-body'), {
            target: { value: 'Second thoughts.' },
        });
        fireEvent.click(screen.getByText('Cancel'));
        expect(board.editFlowNodeClass).not.toHaveBeenCalled();
    });
});

describe('FlowNodeClassPanel instantiable', () => {
    it('offers the class in the Instantiate menu off unless ticked', () => {
        show(classOf([version('v1', 1, 'draft', 'Read the diff.')]));
        const box = screen.getByTestId('flow-node-class-instantiable');
        expect(box).not.toBeChecked();
        fireEvent.click(box);
        expect(board.editFlowNodeClass).toHaveBeenCalledWith('c1', { instantiable: true });
    });

    it('unticks the offer it shows as ticked', () => {
        const one = classOf([version('v1', 1, 'draft', 'Read the diff.')]);
        one.instantiable = true;
        show(one);
        const box = screen.getByTestId('flow-node-class-instantiable');
        expect(box).toBeChecked();
        fireEvent.click(box);
        expect(board.editFlowNodeClass).toHaveBeenCalledWith('c1', { instantiable: false });
    });
});
