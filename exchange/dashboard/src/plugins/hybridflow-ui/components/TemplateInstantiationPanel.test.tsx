import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from 'src/test/render';

/** Instantiating a flow node template. */

/** Markdown, a line at a time — a template literal cannot hold the fences a `. temp. */
const md = (...lines: string[]): string => lines.join('\n');

const BUG_REPORT = md(
    '# Bug report',
    '',
    'What the board wants to know about a bug.',
    '',
    '## Root',
    '',
    '### textTemplate',
    '',
    '```text',
    '# ${flowNodeTitle}',
    '',
    '${flowNodeDescription}',
    '',
    '### Context',
    '',
    '${context:text}',
    '',
    '${steps}',
    '```',
    '',
    '## Steps',
    '',
    '### defaultText',
    '',
    '```text',
    '(not established)',
    '```',
    '',
    '### textTemplate',
    '',
    '```text',
    '### Steps',
    '',
    '1. Run it.',
    '```',
);

const files = await vi.hoisted(async () => {
    const { mockFunctions } = await import('src/test/mocks');
    return mockFunctions('listFiles', 'getFileText', 'getFileJson');
});

/** The board the open flow node is read off — one card saying a title and a description. */
const board = await vi.hoisted(async () => {
    const { createBoardMock } = await import('../test/mocks');
    return createBoardMock();
});

vi.mock('@cms-core', async importOriginal => ({
    ...(await importOriginal<typeof import('@cms-core')>()),
    useWorkerClient: () => files,
    useFileDrop: () => ({ dropping: false, dropProps: {} }),
    extractName: (path: string) => path.slice(path.lastIndexOf('/') + 1),
    VoiceTextArea: (await import('src/test/mocks')).VoiceTextArea,
}));

vi.mock('../Hybridflow-ctx', () => ({
    useHybridflow: () => board,
}));
vi.mock('../Agents-ctx', () => ({
    useAgents: () => ({ agents: [], loading: false, error: null }),
}));
vi.mock('@cms-kit/capabilities', () => ({
    useChatOptions: () => ({ agents: [], optionsFor: () => ({ efforts: [], permissionModes: [] }) }),
}));
vi.mock('../flowNodeTemplates', async importOriginal => ({
    ...(await importOriginal<typeof import('../flowNodeTemplates')>()),
    // The folder is not the subject: a listing that never comes back is a select still loading,
    ensureDefaultFlowNodeTemplates: () => new Promise<string[]>(() => {}),
}));

import { CentralStackProvider, CentralStackView, useCentralStack } from '@cms-core';
import { globalTemplateStore } from '@cms-kit/template-fields';
import { FlowNodeEditingProvider, useFlowNodeEditing } from '../FlowNodeEditing-ctx';
import { versionBodyTemplate } from '../flowNodeTemplates';
import { noSuccess } from '../flowNodeSuccess';
import { TemplateInstantiationPanel } from './TemplateInstantiationPanel';

const PATH = 'kiao-user-config/flow-node-templates/Bug report.temp.md';
const ID = 'template-instantiation';

const onInstantiate = vi.fn();

/** Pushed the way `FlowNodeTemplateSelect` pushes it: titled, cancellable, writing on Instantiate. */
const Opener: React.FC = () => {
    const { push, close } = useCentralStack();
    return (
        <button
            data-testid="open-panel"
            onClick={() => push({
                id: ID,
                title: 'Write the node from “Bug report”',
                closeLabel: 'Cancel',
                content: (
                    <TemplateInstantiationPanel
                        path={PATH}
                        onInstantiate={text => { onInstantiate(text); close(ID); }}
                    />
                ),
            })}
        >
            Open
        </button>
    );
};

/** A keystroke in the editor behind the panel, through the draft both faces share. */
const TypeBehind: React.FC<{ text: string }> = ({ text }) => {
    const { editBody } = useFlowNodeEditing();
    return <button data-testid="type-behind" onClick={() => editBody(text)}>Type</button>;
};

const area = (behind = 'It crashes on Tuesdays.') => (
    <CentralStackProvider>
        <FlowNodeEditingProvider>
            <Opener />
            <TypeBehind text={behind} />
            <CentralStackView />
        </FlowNodeEditingProvider>
    </CentralStackProvider>
);

/** The panel, open on the template, over a card that says a title and a description. */
const open = async (body = 'It crashes.') => {
    const flowNode = {
        id: 'flow-node-1', title: 'Write the plan', type: 'human', tags: [] as string[], body,
        settings: {}, at: '', status: 'ready', chat: '', onSuccess: noSuccess(),
    };
    board.selectedFlowNode = { flowNode, index: 0 };
    render(area(), { workerClient: {} });
    fireEvent.click(screen.getByTestId('open-panel'));
    await screen.findByTestId('template-preview');
};

const preview = () => screen.getByTestId('template-preview').textContent;

const instantiate = () => fireEvent.click(screen.getByRole('button', { name: 'Instantiate' }));
const cancel = () => fireEvent.click(screen.getByTestId(`central-panel-${ID}-close`));

beforeEach(() => {
    vi.clearAllMocks();
    globalTemplateStore.setHeap({});
    globalTemplateStore.setEnabledMap({});
    files.listFiles.mockResolvedValue([]);
    files.getFileText.mockResolvedValue(BUG_REPORT);
});

describe('TemplateInstantiationPanel — what the template makes', () => {
    it('reads the template picked, and shows what it is for', async () => {
        await open();

        expect(files.getFileText).toHaveBeenCalledWith(PATH);
        expect(screen.getByText('What the board wants to know about a bug.')).toBeInTheDocument();
        expect(preview()).toContain('Context');
    });

    it('renders the preview as markdown', async () => {
        await open();

        const shown = screen.getByTestId('template-preview');
        expect(shown.querySelector('h1')).toHaveTextContent('Write the plan');
        expect(shown.querySelector('h3')).toHaveTextContent('Context');
    });

    // The card's own words are what the template is written around, so they are in the result without anybody typing them —.
    it('fills the description and the title itself, and asks for neither', async () => {
        await open();

        expect(preview()).toContain('Write the plan');
        expect(preview()).toContain('It crashes.');
        expect(screen.getAllByTestId('value-field')).toHaveLength(1);
    });

    it('follows the flow node as it is typed behind the panel', async () => {
        await open();
        expect(preview()).toContain('It crashes.');

        fireEvent.click(screen.getByTestId('type-behind'));

        expect(preview()).toContain('It crashes on Tuesdays.');
    });

    it('shows what it makes as it is answered', async () => {
        await open();

        fireEvent.change(screen.getByTestId('value-field'), { target: { value: 'On every open.' } });

        expect(preview()).toContain('On every open.');
    });

    it('turns an optional section on', async () => {
        await open();

        expect(preview()).toContain('(not established)');
        fireEvent.click(screen.getByRole('checkbox'));

        expect(preview()).toContain('Run it.');
        expect(preview()).not.toContain('(not established)');
    });
});

describe('TemplateInstantiationPanel — into the flow node', () => {
    it('hands the instantiated source over, to the character', async () => {
        await open();
        fireEvent.change(screen.getByTestId('value-field'), { target: { value: 'On every open.' } });

        instantiate();

        expect(onInstantiate).toHaveBeenCalledWith(
            '# Write the plan\n\nIt crashes.\n\n### Context\n\nOn every open.\n\n(not established)');
    });

    it('offers no Copy: the text has somewhere to go that is not the clipboard', async () => {
        await open();

        expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
    });

    it('lands on the stack, titled, with the floating cross saying Cancel', async () => {
        await open();

        const stack = screen.getByTestId(`central-panel-${ID}`);
        expect(stack).toHaveTextContent('Write the node from “Bug report”');
        expect(screen.getByTestId(`central-panel-${ID}-close`)).toHaveAccessibleName('Cancel');
    });

    it('is back where the flow node was once instantiated', async () => {
        await open();
        instantiate();

        expect(screen.queryByTestId('template-instantiation')).toBeNull();
    });

    it('hands nothing over when it is cancelled', async () => {
        await open();
        cancel();

        expect(onInstantiate).not.toHaveBeenCalled();
        expect(screen.queryByTestId('template-instantiation')).toBeNull();
    });


    it('keeps the answers, and not the two the flow node filled', async () => {
        await open();

        fireEvent.change(screen.getByTestId('value-field'), { target: { value: 'On every open.' } });
        instantiate();

        const { heap } = globalTemplateStore.getSnapshot();
        expect(heap.context?.value).toBe('On every open.');
        expect(heap.flowNodeDescription).toBeUndefined();
        expect(heap.flowNodeTitle).toBeUndefined();
    });
});

describe('TemplateInstantiationPanel — a class version inline', () => {

    const openInline = async (body = 'Read ${what:text} for “${flowNodeTitle}”.') => {
        const flowNode = {
            id: 'flow-node-1', title: 'Some other card', type: 'human', tags: [] as string[],
            body: 'Unrelated.',
            settings: {}, at: '', status: 'ready', chat: '', onSuccess: noSuccess(),
        };
        board.selectedFlowNode = { flowNode, index: 0 };
        render(
            <CentralStackProvider>
                <FlowNodeEditingProvider>
                    <TemplateInstantiationPanel
                        inline={{ template: versionBodyTemplate(body, 'Review'), title: 'Review' }}
                        onInstantiate={onInstantiate}
                    />
                </FlowNodeEditingProvider>
            </CentralStackProvider>,
            { workerClient: {} },
        );
        await screen.findByTestId('template-preview');
    };

    it('reads no file: the body is the template', async () => {
        await openInline();

        expect(files.getFileText).not.toHaveBeenCalled();
        expect(preview()).toContain('for “Review”.');
        expect(preview()).not.toContain('Some other card');
    });

    it('asks the body\'s variables, and the class answers its title', async () => {
        await openInline();

        expect(screen.getAllByTestId('value-field')).toHaveLength(1);
        fireEvent.change(screen.getByTestId('value-field'), { target: { value: 'the auth module' } });

        expect(preview()).toContain('Read the auth module for “Review”.');
    });

    it('hands the instantiated source over, to the character', async () => {
        await openInline();
        fireEvent.change(screen.getByTestId('value-field'), { target: { value: 'the auth module' } });

        instantiate();

        expect(onInstantiate).toHaveBeenCalledWith('Read the auth module for “Review”.');
    });

    it("offers a complete template's optional blocks", async () => {
        await openInline(md(
            '# Review',
            '',
            '## Root',
            '',
            '### textTemplate',
            '',
            '```text',
            'Read ${what:text}.${context}',
            '```',
            '',
            '## Context',
            '',
            '### defaultText',
            '',
            '```text',
            '',
            '```',
            '',
            '### textTemplate',
            '',
            '```text',
            ' Context: ${detail:text}.',
            '```',
        ));

        fireEvent.change(screen.getByTestId('value-field'), { target: { value: 'the auth module' } });
        expect(preview()).toContain('Read the auth module.');
        expect(preview()).not.toContain('Context:');

        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.change(screen.getAllByTestId('value-field')[1], { target: { value: 'caching' } });
        expect(preview()).toContain('Read the auth module. Context: caching.');
    });
});
