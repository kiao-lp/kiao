import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from 'src/test/render';

/**
 * Instantiating a class: its templates first — one panel per version in template mode, in
 * chain order — its flow nodes after, asked with the instantiated texts.
 */

const board = await vi.hoisted(async () => {
    const { createBoardMock } = await import('./test/mocks');
    return createBoardMock();
});

vi.mock('@cms-core', async importOriginal => ({
    ...(await importOriginal<typeof import('@cms-core')>()),
    useWorkerClient: () => ({ listFiles: async () => [], getFileText: async () => '' }),
    useFileDrop: () => ({ dropping: false, dropProps: {} }),
    extractName: (path: string) => path.slice(path.lastIndexOf('/') + 1),
    VoiceTextArea: (await import('src/test/mocks')).VoiceTextArea,
}));

vi.mock('./Hybridflow-ctx', () => ({
    useHybridflow: () => board,
}));
vi.mock('./Agents-ctx', () => ({
    useAgents: () => ({ agents: [], loading: false, error: null }),
}));
vi.mock('@cms-kit/capabilities', () => ({
    useChatOptions: () => ({ agents: [], optionsFor: () => ({ efforts: [], permissionModes: [] }) }),
}));
vi.mock('./flowNodeTemplates', async importOriginal => ({
    ...(await importOriginal<typeof import('./flowNodeTemplates')>()),
    ensureDefaultFlowNodeTemplates: () => new Promise<string[]>(() => {}),
}));

import { CentralStackProvider, CentralStackView } from '@cms-core';
import { globalTemplateStore } from '@cms-kit/template-fields';
import { FlowNodeEditingProvider } from './FlowNodeEditing-ctx';
import { ListedClassDto } from './service';
import {
    CLASS_TEMPLATE_INSTANTIATION_PANEL_ID, chainReadyForTemplates, templateStepsOf,
    useInstantiateClass, useInstantiateWorkflowClass, workflowReadyForTemplates,
    workflowTemplateStepsOf,
} from './useInstantiateClass';

interface VersionSeed {
    id: string;
    number: number;
    body: string;
    template?: boolean;
    status: string;
}

const target = (
    id: string, title: string, type: string, versions: VersionSeed[], next = '',
    workflowClass = '',
): ListedClassDto => ({
    id,
    title,
    type,
    versions: versions.map(version => ({ ...version, criteria: [] })),
    onSuccess: next ? { flowNode: next, flowNodes: [], mode: 'end' } : undefined,
    workflowClass: workflowClass || undefined,
    boardSlug: 'major',
    boardName: 'Major',
} as unknown as ListedClassDto);

const versions = (...seeds: VersionSeed[]): VersionSeed[] => seeds;

const Trigger: React.FC<{ targets: ListedClassDto[]; classId: string }> = ({ targets, classId }) => {
    const instantiate = useInstantiateClass(targets);
    return (
        <button data-testid="instantiate" onClick={() => instantiate(classId, { x: 10, y: 20 })}>
            Instantiate
        </button>
    );
};

const area = (targets: ListedClassDto[], classId: string) => (
    <CentralStackProvider>
        <FlowNodeEditingProvider>
            <Trigger targets={targets} classId={classId} />
            <CentralStackView />
        </FlowNodeEditingProvider>
    </CentralStackProvider>
);

const panel = () => screen.getByTestId(`central-panel-${CLASS_TEMPLATE_INSTANTIATION_PANEL_ID}`);
const preview = () => screen.getByTestId('template-preview').textContent;
const instantiate = () => fireEvent.click(screen.getByTestId('instantiate-confirm'));
const cancel = () => fireEvent.click(
    screen.getByTestId(`central-panel-${CLASS_TEMPLATE_INSTANTIATION_PANEL_ID}-close`));

beforeEach(() => {
    vi.clearAllMocks();
    globalTemplateStore.setHeap({});
    globalTemplateStore.setEnabledMap({});
    board.selectedFlowNode = null;
});

describe('templateStepsOf', () => {
    it('walks the chain head first, keeping the templates alone', () => {
        const targets = [
            target('c1', 'First', 'human', versions(
                { id: 'v1', number: 1, body: 'Read ${first:text}.', template: true, status: 'published' },
            ), 'c2'),
            target('c2', 'Second', 'human', versions(
                { id: 'v2', number: 1, body: 'Plain words.', status: 'published' },
            ), 'c3'),
            target('c3', 'Third', 'ai', versions(
                { id: 'v3', number: 1, body: 'Then ${third:text}.', template: true, status: 'published' },
            )),
        ];
        expect(templateStepsOf(targets, 'c1')).toEqual([
            { classId: 'c1', classTitle: 'First', versionNumber: 1, body: 'Read ${first:text}.' },
            { classId: 'c3', classTitle: 'Third', versionNumber: 1, body: 'Then ${third:text}.' },
        ]);
    });

    it('reads the latest published version, never a newer draft', () => {
        const targets = [target('c1', 'First', 'human', versions(
            { id: 'v1', number: 1, body: 'Read ${first:text}.', template: true, status: 'published' },
            { id: 'v2', number: 2, body: 'Draft words.', status: 'draft' },
        ))];
        expect(templateStepsOf(targets, 'c1')).toEqual([
            { classId: 'c1', classTitle: 'First', versionNumber: 1, body: 'Read ${first:text}.' },
        ]);
    });

    it('steps through no version of what the board plays to itself', () => {
        const targets = [target('c1', 'Off', 'shutdown', versions(
            { id: 'v1', number: 1, body: 'Ticked ${x:text}.', template: true, status: 'published' },
        ))];
        expect(templateStepsOf(targets, 'c1')).toEqual([]);
    });

    it('steps through nothing where the class has gone', () => {
        expect(templateStepsOf([], 'nowhere')).toEqual([]);
    });
});

describe('chainReadyForTemplates', () => {
    it('refuses a chain with a class nothing published', () => {
        const targets = [
            target('c1', 'First', 'human', versions(
                { id: 'v1', number: 1, body: 'Read ${first:text}.', template: true, status: 'published' },
            ), 'c2'),
            target('c2', 'Second', 'human', versions(
                { id: 'v2', number: 1, body: 'Draft words.', status: 'draft' },
            )),
        ];
        expect(chainReadyForTemplates(targets, 'c1')).toBe(false);
    });

    it('refuses a class that has gone, and accepts a chain that is all published', () => {
        const targets = [target('c1', 'First', 'human', versions(
            { id: 'v1', number: 1, body: 'Read ${first:text}.', template: true, status: 'published' },
        ))];
        expect(chainReadyForTemplates(targets, 'nowhere')).toBe(false);
        expect(chainReadyForTemplates(targets, 'c1')).toBe(true);
    });
});

describe('useInstantiateClass', () => {
    it('goes straight through where nothing of the chain is a template', () => {
        const targets = [target('c1', 'First', 'human', versions(
            { id: 'v1', number: 1, body: 'Plain words.', status: 'published' },
        ))];
        render(area(targets, 'c1'), { workerClient: {} });
        fireEvent.click(screen.getByTestId('instantiate'));

        expect(board.instantiateFlowNodeClass).toHaveBeenCalledWith('c1', { x: 10, y: 20 });
        expect(screen.queryByTestId('central-stack')).toBeNull();
    });

    // Instantiated inside a rectangle: the rectangle travels with the call, so the nodes it
    // makes are grouped in it — the Trigger below is the rectangle's own menu, aimed there.
    it('carries the rectangle where the instantiation was aimed inside one', () => {
        const targets = [target('c1', 'First', 'human', versions(
            { id: 'v1', number: 1, body: 'Plain words.', status: 'published' },
        ))];
        const TriggerInWorkflow: React.FC = () => {
            const instantiate = useInstantiateClass(targets);
            return (
                <button
                    data-testid="instantiate-in-workflow"
                    onClick={() => instantiate('c1', { x: 10, y: 20 }, 'w1')}
                >
                    Instantiate
                </button>
            );
        };
        render(
            <CentralStackProvider>
                <FlowNodeEditingProvider>
                    <TriggerInWorkflow />
                    <CentralStackView />
                </FlowNodeEditingProvider>
            </CentralStackProvider>,
            { workerClient: {} },
        );
        fireEvent.click(screen.getByTestId('instantiate-in-workflow'));

        expect(board.instantiateFlowNodeClass)
            .toHaveBeenCalledWith('c1', { x: 10, y: 20 }, undefined, 'w1');
    });

    it('goes straight through where the chain has nothing published to instantiate', () => {
        const targets = [
            target('c1', 'First', 'human', versions(
                { id: 'v1', number: 1, body: 'Read ${first:text}.', template: true, status: 'published' },
            ), 'c2'),
            target('c2', 'Second', 'human', versions(
                { id: 'v2', number: 1, body: 'Draft words.', status: 'draft' },
            )),
        ];
        render(area(targets, 'c1'), { workerClient: {} });
        fireEvent.click(screen.getByTestId('instantiate'));

        // The refusal is the service's to word: no panel, just the call.
        expect(board.instantiateFlowNodeClass).toHaveBeenCalledWith('c1', { x: 10, y: 20 });
        expect(screen.queryByTestId('central-stack')).toBeNull();
    });

    it('walks the templates one by one, then makes the flow nodes with the texts', () => {
        // A complete `.temp.md` template, with the optional block the panel offers as a
        // checkbox; the second template is plain words, read as the Root alone.
        const md = (...lines: string[]): string => lines.join('\n');
        const targets = [
            target('c1', 'First', 'human', versions(
                {
                    id: 'v1', number: 1, template: true, status: 'published',
                    body: md(
                        '# First',
                        '',
                        '## Root',
                        '',
                        '### textTemplate',
                        '',
                        '```text',
                        'Read ${first:text}.${context}',
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
                    ),
                },
            ), 'c2'),
            target('c2', 'Second', 'human', versions(
                { id: 'v2', number: 1, body: 'Plain words.', status: 'published' },
            ), 'c3'),
            target('c3', 'Third', 'ai', versions(
                { id: 'v3', number: 2, body: 'Then ${third:text}.', template: true, status: 'published' },
            )),
        ];
        render(area(targets, 'c1'), { workerClient: {} });
        fireEvent.click(screen.getByTestId('instantiate'));

        // The first template, named with its class, its version and its step.
        expect(panel()).toHaveTextContent('Write “First” v1 from its template (1 of 2)');
        const fields = () => screen.getAllByTestId('value-field');
        fireEvent.change(fields()[0], { target: { value: 'the auth module' } });
        expect(preview()).toContain('Read the auth module.');
        expect(preview()).not.toContain('Context:');
        expect(board.instantiateFlowNodeClass).not.toHaveBeenCalled();

        // The optional block, ticked: its field appears and its words join the preview.
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.change(fields()[1], { target: { value: 'caching' } });
        expect(preview()).toContain('Read the auth module. Context: caching.');

        // Instantiate walks to the next template rather than making anything.
        instantiate();
        expect(panel()).toHaveTextContent('Write “Third” v2 from its template (2 of 2)');
        expect(board.instantiateFlowNodeClass).not.toHaveBeenCalled();
        fireEvent.change(screen.getByTestId('value-field'), { target: { value: 'the tests' } });
        expect(preview()).toContain('Then the tests.');

        // The last Instantiate makes the flow nodes and is back on the board.
        instantiate();
        expect(screen.queryByTestId('central-stack')).toBeNull();
        expect(board.instantiateFlowNodeClass).toHaveBeenCalledTimes(1);
        expect(board.instantiateFlowNodeClass).toHaveBeenCalledWith('c1', { x: 10, y: 20 }, {
            c1: 'Read the auth module. Context: caching.',
            c3: 'Then the tests.',
        });
    });

    it('makes nothing where the wizard is cancelled halfway', () => {
        const targets = [
            target('c1', 'First', 'human', versions(
                { id: 'v1', number: 1, body: 'Read ${first:text}.', template: true, status: 'published' },
            ), 'c2'),
            target('c2', 'Second', 'ai', versions(
                { id: 'v2', number: 1, body: 'Then ${second:text}.', template: true, status: 'published' },
            )),
        ];
        render(area(targets, 'c1'), { workerClient: {} });
        fireEvent.click(screen.getByTestId('instantiate'));
        fireEvent.change(screen.getByTestId('value-field'), { target: { value: 'the auth module' } });
        instantiate();
        expect(panel()).toHaveTextContent('(2 of 2)');

        cancel();

        expect(screen.queryByTestId('central-stack')).toBeNull();
        expect(board.instantiateFlowNodeClass).not.toHaveBeenCalled();
    });
});

describe('workflowTemplateStepsOf', () => {
    it('walks the members in member order, keeping the templates alone', () => {
        const targets = [
            target('c1', 'First', 'human', versions(
                { id: 'v1', number: 1, body: 'Read ${first:text}.', template: true, status: 'published' },
            ), '', 'w1'),
            target('c2', 'Outside', 'human', versions(
                { id: 'v2', number: 1, body: 'Elsewhere ${x:text}.', template: true, status: 'published' },
            )),
            target('c3', 'Third', 'ai', versions(
                { id: 'v3', number: 1, body: 'Plain words.', status: 'published' },
            ), '', 'w1'),
            target('c4', 'Fourth', 'ai', versions(
                { id: 'v4', number: 1, body: 'Then ${fourth:text}.', template: true, status: 'published' },
            ), '', 'w1'),
        ];
        expect(workflowTemplateStepsOf(targets, 'w1')).toEqual([
            { classId: 'c1', classTitle: 'First', versionNumber: 1, body: 'Read ${first:text}.' },
            { classId: 'c4', classTitle: 'Fourth', versionNumber: 1, body: 'Then ${fourth:text}.' },
        ]);
    });

    it('steps through nothing where the rectangle holds no classes', () => {
        expect(workflowTemplateStepsOf([], 'w1')).toEqual([]);
    });
});

describe('workflowReadyForTemplates', () => {
    it('refuses an empty rectangle and a member with nothing published', () => {
        expect(workflowReadyForTemplates([], 'w1')).toBe(false);
        const targets = [
            target('c1', 'First', 'human', versions(
                { id: 'v1', number: 1, body: 'Read ${first:text}.', template: true, status: 'published' },
            ), '', 'w1'),
            target('c2', 'Second', 'human', versions(
                { id: 'v2', number: 1, body: 'Draft words.', status: 'draft' },
            ), '', 'w1'),
        ];
        expect(workflowReadyForTemplates(targets, 'w1')).toBe(false);
        expect(workflowReadyForTemplates(targets.slice(0, 1), 'w1')).toBe(true);
    });
});

describe('useInstantiateWorkflowClass', () => {
    const workflowArea = (targets: ListedClassDto[], workflowClassId: string) => {
        const TriggerWorkflow: React.FC = () => {
            const instantiate = useInstantiateWorkflowClass(targets);
            return (
                <button
                    data-testid="instantiate-workflow"
                    onClick={() => instantiate(workflowClassId, { x: 10, y: 20 })}
                >
                    Instantiate
                </button>
            );
        };
        return (
            <CentralStackProvider>
                <FlowNodeEditingProvider>
                    <TriggerWorkflow />
                    <CentralStackView />
                </FlowNodeEditingProvider>
            </CentralStackProvider>
        );
    };

    it('goes straight through where no member is a template', () => {
        const targets = [target('c1', 'First', 'human', versions(
            { id: 'v1', number: 1, body: 'Plain words.', status: 'published' },
        ), '', 'w1')];
        render(workflowArea(targets, 'w1'), { workerClient: {} });
        fireEvent.click(screen.getByTestId('instantiate-workflow'));

        expect(board.instantiateWorkflowClass).toHaveBeenCalledWith('w1', { x: 10, y: 20 });
        expect(screen.queryByTestId('central-stack')).toBeNull();
    });

    it('walks the member templates, then makes the workflow with the texts', () => {
        const targets = [target('c1', 'First', 'human', versions(
            { id: 'v1', number: 1, body: 'Read ${first:text}.', template: true, status: 'published' },
        ), '', 'w1')];
        render(workflowArea(targets, 'w1'), { workerClient: {} });
        fireEvent.click(screen.getByTestId('instantiate-workflow'));

        expect(panel()).toHaveTextContent('Write “First” v1 from its template (1 of 1)');
        fireEvent.change(screen.getByTestId('value-field'), { target: { value: 'the auth module' } });
        instantiate();

        expect(screen.queryByTestId('central-stack')).toBeNull();
        expect(board.instantiateWorkflowClass).toHaveBeenCalledWith('w1', { x: 10, y: 20 }, {
            c1: 'Read the auth module.',
        });
    });
});
