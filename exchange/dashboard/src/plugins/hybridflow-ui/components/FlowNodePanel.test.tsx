import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from 'src/test/render';

/** The node panel edits the selected flow node through one draft. */

const FLOW_NODE_ID = 'flow-node-1';

const flowNode = (title: string, body: string, settings: Record<string, string> = {}) =>
    ({
        id: FLOW_NODE_ID, title, type: settings.agent || settings.model ? 'ai' : 'human', tags: [] as string[], body,
        criteria: [], complexity: null, settings, at: '', status: 'ready', chat: '', onSuccess: noSuccess(),
    });

const board = await vi.hoisted(async () => {
    const { createBoardMock } = await import('../test/mocks');
    return createBoardMock();
});

const show = vi.hoisted(() => ({ showConversation: vi.fn() }));
const toolBars = vi.hoisted(() => ({ showTab: vi.fn(), activeCenter: 'document' }));

const config = vi.hoisted(() => ({ chatEnabled: true }));

/**
 * The store's `flow-node-templates` folder, as the editor reads it — and **when** it answers.
 * A folder that answers a test which never waited for it is a state update landing after that test.
 */
const templateFolder = vi.hoisted(() => ({
    paths: [
        'kiao-user-config/flow-node-templates/AI.temp.md',
        'kiao-user-config/flow-node-templates/Bug report.temp.md',
        'kiao-user-config/flow-node-templates/Human.temp.md',
    ],
    answers: false,
}));

vi.mock('../flowNodeTemplates', async importOriginal => ({
    ...(await importOriginal<typeof import('../flowNodeTemplates')>()),
    ensureDefaultFlowNodeTemplates: () => (templateFolder.answers
        ? Promise.resolve(templateFolder.paths)
        : new Promise<string[]>(() => {})),
}));

vi.mock('../Hybridflow-ctx', () => ({
    useHybridflow: () => board,
}));
vi.mock('@kiao-dashboard-core', async importOriginal => ({
    ...(await importOriginal<typeof import('@kiao-dashboard-core')>()),
    markdownLinkDrop: [],
    useFileDrop: () => ({ dropping: false, dropProps: {} }),
    RevealInTreeButton: ({ path, 'data-testid': testId }: { path: string | null; 'data-testid'?: string }) =>
        <button type="button" data-testid={testId} disabled={path === null} />,
    useDashboardConfig: () => config,
    useToolBars: () => ({ showTab: toolBars.showTab, activeIn: () => toolBars.activeCenter }),
    useToolBarsOptional: () => ({ showTab: toolBars.showTab, activeIn: () => toolBars.activeCenter }),
    useWorkerClient: () => ({ deleteHarnessConversation: vi.fn().mockResolvedValue(undefined) }),
    useRefreshFileList: () => vi.fn(),
    extractName: (path: string) => path.slice(path.lastIndexOf('/') + 1),
    parentPath: (path: string) => (path.lastIndexOf('/') === 0 ? '/' : path.slice(0, path.lastIndexOf('/'))),
    ConfiguredMarkdown: ({ children }: { children: string }) => <div data-testid="description-preview">{children}</div>,
    CodeMirrorTextEditor: ({ value, onChange, onEditor }: {
        value: string; onChange: (v: string) => void; onEditor?: (view: any) => void;
    }) => {
        const box = React.useRef<HTMLTextAreaElement>(null);
        const held = React.useRef(value);
        held.current = value;
        React.useEffect(() => {
            if (!editorMade.announced) return;
            onEditor?.({
                focus: () => box.current?.focus(),
                dispatch: (spec: any) => { editorMade.dispatched.push(spec); },
                state: { doc: { toString: () => held.current, get length() { return held.current.length; } } },
            });
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);
        return (
            <textarea
                ref={box}
                data-testid="panel-source"
                value={value}
                onChange={event => onChange(event.target.value)}
            />
        );
    },
    Tooltip: (await import('antd')).Tooltip,
}));

const TEST_AGENTS = await vi.hoisted(async () => {
    const { harnessOptions } = await import('src/test/harnesses');
    return [harnessOptions({
        models: [{ value: 'opus', label: 'Opus' }],
        efforts: [{ value: 'high', label: 'High' }],
        permissionModes: [{ value: 'manualLive', label: 'Manual Live' }],
    })];
});

vi.mock('@kiao-dashboard-kit/capabilities', () => ({
    // Everything the board asks of an agent, as the contract rather than as a plugin: showing the
    useShowChat: () => show.showConversation,
    useChatRunAvailable: () => config.chatEnabled,
    useChatOptions: () => ({
        harnesses: TEST_AGENTS,
        optionsFor: (agent: string) => TEST_AGENTS.find(one => one.value === agent) ?? TEST_AGENTS[0],
    }),
    useTagsUi: () => ({
        TagChips: () => null,
        TagPicker: ({ value, ...rest }: { value: string[] }) => <div {...rest}>{value.join(' ')}</div>,
    }),
}));


vi.mock('../Agents-ctx', () => ({
    useAgents: () => ({
        agents: [
            { id: 'agent-1', name: 'Reviewer', harness: 'claude', model: 'opus', published: { harness: 'claude' } },
            { id: 'agent-2', name: 'Runner', harness: 'codex', model: 'gpt-5.1-codex', published: { harness: 'codex' } },
        ],
        loading: false,
        error: null,
    }),
}));

const editorMade = vi.hoisted(() => ({ announced: true, dispatched: [] as any[] }));

vi.mock('./TemplateInstantiationPanel', () => ({
    TemplateInstantiationPanel: ({ path, onInstantiate }: {
        path: string; onInstantiate: (text: string) => void;
    }) => (
        <button data-testid="template-instantiation" onClick={() => onInstantiate('### Steps\n\nDo it.')}>
            {path}
        </button>
    ),
}));

const paste = vi.hoisted(() => ({
    folder: '',
    documentName: '',
    linkFromRoot: false,
    insert: (_snippet: string) => {},
    onPasteCapture: vi.fn(),
    insertBlockAt: vi.fn(),
}));

vi.mock('@kiao-dashboard-kit/markdown-editor', () => ({
    ImagePasteModal: () => <div data-testid="image-paste-modal" />,
    insertBlockAt: paste.insertBlockAt,
    markdownInlineKeymap: [],
    useImagePaste: (folder: string, documentName: string, insert: (snippet: string) => void, linkFromRoot = false) => {
        paste.folder = folder;
        paste.documentName = documentName;
        paste.linkFromRoot = linkFromRoot;
        paste.insert = insert;
        return { onPasteCapture: paste.onPasteCapture, modalProps: {} };
    },
}));

import { CentralStackProvider, CentralStackView, DOCUMENT_TAB_ID } from '@kiao-dashboard-core';
import { FlowNodePanel } from './FlowNodePanel';
import { BOARD_TAB_ID } from '../constants';
import { FlowNodeEditingProvider } from '../FlowNodeEditing-ctx';
import { noSuccess } from '../flowNodeSuccess';
import { FakeHybridflowClient, HybridflowClientProvider } from '../service';
import { readBoardContent } from '../boardContent';
import styles from '../Hybridflow.module.css';

/** The panel with the central stack its template form pushes onto. */
const Faces: React.FC = () => (
    <CentralStackProvider>
        <FlowNodeEditingProvider>
            <FlowNodePanel />
            <CentralStackView />
        </FlowNodeEditingProvider>
    </CentralStackProvider>
);

const HostedFaces: React.FC = () => (
    <CentralStackProvider>
        <FlowNodeEditingProvider>
            <FlowNodePanel />
            <div data-testid="document-central"><CentralStackView host={DOCUMENT_TAB_ID} /></div>
            <div data-testid="board-central"><CentralStackView host={BOARD_TAB_ID} /></div>
        </FlowNodeEditingProvider>
    </CentralStackProvider>
);

const openOptions = () => fireEvent.click(screen.getByRole('tab', { name: 'Options' }));
const openSpec = () => fireEvent.click(screen.getByRole('tab', { name: 'Spec' }));
const renderOptions = (ui = <Faces />) => {
    const view = render(ui);
    openOptions();
    return view;
};

/** The panel's description box. */
const panelSource = () => within(screen.getByTestId('flow-node-panel')).getByTestId('panel-source');

const openTemplates = async () => {
    const button = screen.getByRole('button', { name: 'Instantiate template' });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    return screen.findByRole('menu');
};

const chooseTemplate = async (name: string) => {
    const menu = await openTemplates();
    fireEvent.click(within(menu).getByRole('menuitem', { name }));
};

/** Opens the panel's model select and takes the option named. */
const choose = (label: string, option: string) => {
    openOptions();
    fireEvent.mouseDown(document.querySelector(`.ant-select[aria-label="${label}"] .ant-select-content`)!);
    fireEvent.click(document.querySelector(`.ant-select-item-option[title="${option}"]`)!);
};

/** Points the panel at a flow node of a board holding it and the others. */
const showing = (held: ReturnType<typeof flowNode>, ...others: ReturnType<typeof flowNode>[]) => {
    board.content = { flowNodes: [held, ...others] };
    board.selectedFlowNode = { flowNode: held, index: 0 };
};

/** Another card, which a chain may name wherever it sits. */
const other = (id: string, title: string) => ({ ...flowNode(title, ''), id });

beforeEach(() => {
    vi.clearAllMocks();
    config.chatEnabled = true;
    board.openingId = 1;
    board.titleCaret = null;
    editorMade.announced = true;
    editorMade.dispatched = [];
    toolBars.activeCenter = 'document';
    templateFolder.answers = false;
    showing(flowNode('Write the plan', 'lead'));
});

describe('AI task editing by status', () => {
    const task = (status: string, type = 'ai') => ({
        ...flowNode('Write the plan', 'Original description', {
            agent: 'agent-1', effort: 'high', permission: 'manualLive', folder: '/',
        }),
        type, status, outputType: 'schema-1',
        criteria: [{ id: 'criterion-1', text: 'It holds' }],
    } as any);

    const expectLocked = (face: HTMLElement) => {
        const ui = within(face);
        openOptions();
        for (const label of ['Agent', 'Effort', 'Permission mode', 'Transition mode', 'On success']) {
            expect(ui.getByRole('combobox', { name: label })).toBeDisabled();
        }
        expect(ui.getByTestId('flow-node-compact')).toBeDisabled();
        expect(ui.queryByTestId('instantiate-template')).toBeNull();
        expect(ui.getByRole('button', { name: 'Status' })).not.toBeDisabled();
        openSpec();
        expect(ui.getByRole('combobox', { name: 'Output type' })).toBeDisabled();
        expect(ui.getByLabelText('Working directory')).toHaveAttribute('readonly');
        expect(ui.getByLabelText('Success criterion')).toHaveAttribute('readonly');
        expect(ui.getByTestId('description-preview')).toHaveTextContent('Original description');
        expect(ui.queryByRole('button', { name: 'Add success criterion' })).toBeNull();
        expect(ui.queryByRole('button', { name: 'Remove success criterion' })).toBeNull();
    };

    it.each(['blocked', 'running', 'waiting-refresh', 'interrupted', 'done', 'error'])(
        'locks task inputs in the panel for %s', status => {
            showing(task(status));
            render(<Faces />);
            expectLocked(screen.getByTestId('flow-node-panel'));
            expect(screen.queryByTestId('panel-source')).toBeNull();
            fireEvent.keyDown(screen.getByLabelText('Success criterion'), { key: 'Enter' });
            fireEvent.change(screen.getByLabelText('Success criterion'), { target: { value: 'Changed' } });
            fireEvent.change(screen.getByLabelText('Working directory'), { target: { value: '/changed' } });
            expect(board.editFlowNode).not.toHaveBeenCalled();
        },
    );

    it.each(['draft', 'ready'])('unlocks the panel when the task becomes %s', status => {
        showing(task('running'));
        const { rerender } = render(<Faces />);
        showing(task(status));
        rerender(<Faces />);
        const ui = within(screen.getByTestId('flow-node-panel'));
        openOptions();
        expect(ui.getByRole('combobox', { name: 'Agent' })).not.toBeDisabled();
        openSpec();
        expect(ui.getByRole('combobox', { name: 'Output type' })).not.toBeDisabled();
        expect(ui.getByTestId('instantiate-template')).toBeVisible();
        expect(ui.getByLabelText('Working directory')).not.toHaveAttribute('readonly');
        expect(ui.getByLabelText('Success criterion')).not.toHaveAttribute('readonly');
        expect(ui.getByRole('button', { name: 'Add success criterion' })).toBeInTheDocument();
        fireEvent.change(panelSource(), { target: { value: 'Updated description' } });
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, { body: 'Updated description' });
    });

    it('locks the panel when a task starts', () => {
        showing(task('ready'));
        const { rerender } = render(<Faces />);
        showing(task('running'));
        rerender(<Faces />);
        expectLocked(screen.getByTestId('flow-node-panel'));
    });

    it('blocks a template opened before the task started from replacing its description', async () => {
        templateFolder.answers = true;
        showing(task('ready'));
        const { rerender } = render(<Faces />);
        await chooseTemplate('AI');
        showing(task('running'));
        rerender(<Faces />);
        fireEvent.click(screen.getByTestId('template-instantiation'));
        expect(board.editFlowNode).not.toHaveBeenCalled();
        expect(screen.getByTestId('description-preview')).toHaveTextContent('Original description');
    });

    it('locks task text and output schema when chat is unavailable', () => {
        config.chatEnabled = false;
        showing(task('done'));
        render(<Faces />);
        expect(screen.getByRole('combobox', { name: 'Output type' })).toBeDisabled();
        expect(screen.getByTestId('description-preview')).toHaveTextContent('Original description');
        expect(screen.queryByTestId('instantiate-template')).toBeNull();
        expect(screen.queryByTestId('flow-node-criteria-add')).toBeNull();
    });

    it('keeps Human tasks editable after completion', () => {
        showing(task('done', 'human'));
        render(<Faces />);
        expect(panelSource()).toHaveValue('Original description');
        expect(screen.getByTestId('flow-node-criteria-add')).toBeInTheDocument();
        openOptions();
        expect(screen.getByTestId('instantiate-template')).toBeInTheDocument();
    });
});

describe('FlowNodePanel — which flow node it is showing', () => {
    it('shows the title and the body as the two fields they are', () => {
        render(<Faces />);
        expect(screen.getByTestId('flow-node-title')).toHaveValue('Write the plan');
        expect(panelSource()).toHaveValue('lead');
    });


    it('takes the title focus asked for the flow node it is showing', () => {
        board.titleCaret = FLOW_NODE_ID;
        render(<Faces />);
        expect(screen.getByTestId('flow-node-title')).toHaveFocus();
        expect(board.takeTitleCaret).toHaveBeenCalled();
    });

    it('leaves a title focus asked for another flow node alone', () => {
        board.titleCaret = 'another-flow-node';
        render(<Faces />);
        expect(screen.getByTestId('flow-node-title')).not.toHaveFocus();
        expect(board.takeTitleCaret).not.toHaveBeenCalled();
    });


    it('draws no description on a card that is no task', () => {
        showing({ ...flowNode('And off', 'lead'), type: 'shutdown' } as any);
        render(<Faces />);
        expect(screen.getByTestId('flow-node-title')).toHaveValue('And off');
        expect(within(screen.getByTestId('flow-node-panel')).queryByTestId('panel-source'))
            .not.toBeInTheDocument();
    });

    it('draws the description on both kinds of task', () => {
        for (const type of ['ai', 'human'] as const) {
            showing({ ...flowNode('Write the plan', 'lead'), type } as any);
            const view = render(<Faces />);
            expect(panelSource()).toHaveValue('lead');
            view.unmount();
        }
    });

    it('says so when there is no flow node open', () => {
        board.selectedFlowNode = null;
        render(<Faces />);
        expect(screen.getByText('Select a node on the board to edit it.')).toBeInTheDocument();
    });

    it('follows a flow node opened while another was open', () => {
        const { rerender } = render(<Faces />);
        expect(panelSource()).toHaveValue('lead');

        showing({
            id: 'flow-node-2', title: 'Ship it', type: 'human', tags: [], body: '', criteria: [], complexity: null,
            settings: {}, at: '', status: 'ready', chat: '', onSuccess: noSuccess(),
        });
        board.openingId += 1;
        rerender(<Faces />);

        expect(screen.getByTestId('flow-node-title')).toHaveValue('Ship it');
        expect(panelSource()).toHaveValue('');
    });

    it('stays put when the board hands back what the panel just wrote', () => {
        const { rerender } = render(<Faces />);

        fireEvent.change(panelSource(), { target: { value: 'lead\n\nmore' } });
        showing(flowNode('Write the plan', 'lead\n\nmore'));
        rerender(<Faces />);

        expect(panelSource()).toHaveValue('lead\n\nmore');
        expect(board.editFlowNode).toHaveBeenCalledTimes(1);
    });

    it('takes a mark made on the flow node it is open on', () => {
        const { rerender } = render(<Faces />);

        showing({ ...flowNode('Write the plan', 'lead'), status: 'done', chat: 'chat-1' });
        rerender(<Faces />);

        expect(panelSource()).toHaveValue('lead');
    });

    it('takes a title written into the open flow node from elsewhere', () => {
        const { rerender } = render(<Faces />);

        showing(flowNode('Renamed by a turn', 'lead'));
        rerender(<Faces />);

        expect(screen.getByTestId('flow-node-title')).toHaveValue('Renamed by a turn');
    });
});

describe('task views', () => {
    let service: FakeHybridflowClient;
    const face = () => (
        <HybridflowClientProvider client={service.asClient()}>
            <Faces />
        </HybridflowClientProvider>
    );
    const show = async () => {
        const view = render(face());
        await act(async () => {});
        return view;
    };

    beforeEach(() => {
        service = new FakeHybridflowClient(readBoardContent({ flowNodes: [] }));
        service.usageTotalsByFlowNode[FLOW_NODE_ID] = {
            reports: 2, inputTokens: 12400, outputTokens: 3100,
            cacheReadTokens: 8000, cacheWriteTokens: 1200, reasoningTokens: 500,
            costUsdMicros: 1_230_000,
        };
    });

    it('shows consumption and stored result in Result while keeping the Spec draft mounted', async () => {
        showing({ ...flowNode('Write the plan', 'lead', { agent: 'agent-1' }), output: { message: 'Done' } } as any);
        await show();
        const source = panelSource();
        expect(screen.getByRole('tab', { name: 'Spec' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByTestId('flow-node-result')).toBeNull();
        expect(service.calls).not.toContain(`flowNodeUsageTotals major ${FLOW_NODE_ID}`);
        fireEvent.change(source, { target: { value: 'Draft in progress' } });

        fireEvent.click(screen.getByRole('tab', { name: 'Result' }));
        expect(await screen.findByTestId('flow-node-costs')).toHaveTextContent('$1.23 · 12.4K in / 3.1K out');
        expect(screen.getByTestId('flow-node-result')).toHaveTextContent('"message": "Done"');
        expect(source).toBeInTheDocument();
        expect(source.closest('[role="tabpanel"]')).toHaveAttribute('aria-hidden', 'true');
        expect(screen.getByTestId('archive-flow-node')).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Delete node' })).toBeNull();

        openSpec();
        expect(panelSource()).toBe(source);
        expect(source).toBeVisible();
        expect(source).toHaveValue('Draft in progress');
        expect(screen.queryByTestId('flow-node-result')).toBeNull();
    });

    it('refreshes consumption when Result is reopened', async () => {
        showing(flowNode('Write the plan', 'lead', { agent: 'agent-1' }));
        await show();
        fireEvent.click(screen.getByRole('tab', { name: 'Result' }));
        await screen.findByTestId('flow-node-costs');
        openSpec();
        service.usageTotalsByFlowNode[FLOW_NODE_ID].costUsdMicros = 2_000_000;
        fireEvent.click(screen.getByRole('tab', { name: 'Result' }));
        expect(await screen.findByTestId('flow-node-costs')).toHaveTextContent('$2.00');
        expect(service.calls.filter(call => call === `flowNodeUsageTotals major ${FLOW_NODE_ID}`)).toHaveLength(2);
    });

    it('returns to Spec when another task is selected', async () => {
        const view = await show();
        fireEvent.click(screen.getByRole('tab', { name: 'Result' }));
        showing(other('another-task', 'Next task'));
        view.rerender(face());
        await act(async () => {});
        expect(screen.getByRole('tab', { name: 'Spec' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('flow-node-title')).toHaveValue('Next task');
        expect(panelSource()).toBeVisible();
    });

    it.each([null, false, 0, 'Done', { message: 'Done' }])('shows Human output %j without reading consumption', async output => {
        showing({ ...flowNode('Review it', 'lead'), output } as any);
        await show();
        fireEvent.click(screen.getByRole('tab', { name: 'Result' }));
        expect(screen.getByTestId('flow-node-result').querySelector('pre')?.textContent)
            .toBe(JSON.stringify(output, null, 2));
        expect(service.calls.some(call => call.startsWith('flowNodeUsageTotals'))).toBe(false);
    });

    it('shows an empty state before a task has a result', async () => {
        await show();
        fireEvent.click(screen.getByRole('tab', { name: 'Result' }));
        expect(screen.getByText('No result yet.')).toBeVisible();
    });

    it('shows the result on a completed AI task when chat is unavailable', async () => {
        config.chatEnabled = false;
        showing({ ...flowNode('Write the plan', 'lead', { agent: 'agent-1' }), status: 'done', output: 'Done' } as any);
        await show();
        expect(screen.getByRole('combobox', { name: 'Output type' })).toBeDisabled();
        fireEvent.click(screen.getByRole('tab', { name: 'Result' }));
        expect(await screen.findByTestId('flow-node-costs')).toBeVisible();
        expect(screen.getByTestId('flow-node-result')).toHaveTextContent('"Done"');
    });

    it.each(['shutdown', 'scheduler', 'gateway', 'note'])('keeps %s nodes in a single view', type => {
        showing({ ...flowNode('A node', ''), type } as any);
        render(<Faces />);
        expect(screen.queryByRole('tab')).toBeNull();
    });
});

describe('FlowNodePanel — writing the flow node', () => {
    it('writes the title on its own', () => {
        render(<Faces />);
        fireEvent.change(screen.getByTestId('flow-node-title'), { target: { value: 'Renamed' } });
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, { title: 'Renamed' });
    });

    it('writes the body on its own', () => {
        render(<Faces />);
        fireEvent.change(panelSource(), { target: { value: 'new body' } });
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, { body: 'new body' });
    });

    it('leaves a heading in the body exactly as it is typed', () => {
        render(<Faces />);
        fireEvent.change(panelSource(), { target: { value: '# Steps\n\n## Later' } });
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, { body: '# Steps\n\n## Later' });
    });

    it('writes the agent picked onto the flow node', () => {
        showing(flowNode('Write the plan', 'lead', { agent: 'agent-1', effort: 'high' }));
        render(<Faces />);

        choose('Agent', 'Runner');

        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            settings: { agent: 'agent-2' },
        });
    });

    it('writes the other three settings without touching the body', () => {
        showing(flowNode('Write the plan', 'lead', { model: 'opus' }));
        render(<Faces />);

        fireEvent.change(screen.getByLabelText('Working directory'), { target: { value: 'exchange' } });

        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, { settings: { model: 'opus', folder: '/exchange' } });
        expect(panelSource()).toHaveValue('lead');
    });

    describe('the crosshair at the end of the folder box', () => {
        const crosshair = () => screen.getAllByTestId('flow-node-folder-locate')[0];

        it('points at the folder the flow node names', () => {
            showing(flowNode('Write the plan', 'lead', { model: 'opus', folder: 'exchange/dashboard' }));
            render(<Faces />);

            expect(crosshair()).toBeEnabled();
        });

        it('is dark on a flow node whose folder has not been filled in', () => {
            showing(flowNode('Write the plan', 'lead', { model: 'opus' }));
            render(<Faces />);

            expect(crosshair()).toBeDisabled();
        });
    });
});

/** A screenshot is half of what a flow node about a screen is, and it is pasted into whichever box is. */
describe('FlowNodePanel — the image pasted into a flow node', () => {
    it('takes the paste on the body editor', () => {
        render(<Faces />);
        fireEvent.paste(panelSource());
        expect(paste.onPasteCapture).toHaveBeenCalled();
    });

    it('offers the board’s own folder as where the image belongs, and links it from the store root', () => {
        render(<Faces />);
        expect(paste.folder).toBe('boards/major');
        expect(paste.documentName).toBe('major');
        expect(paste.linkFromRoot).toBe(true);
    });

    it('writes the link where the caret is, through the editor itself', () => {
        showing(flowNode('Write the plan', 'Look at this.'));
        render(<Faces />);

        act(() => paste.insert('![shot.png](/boards/major/shot.png)'));

        expect(paste.insertBlockAt).toHaveBeenCalledWith(expect.anything(), '![shot.png](/boards/major/shot.png)');
    });

    it('puts the link at the end of the body when there is no editor to take it', () => {
        editorMade.announced = false;
        showing(flowNode('Write the plan', 'Look at this.'));
        render(<Faces />);

        act(() => paste.insert('![shot.png](/boards/major/shot.png)'));

        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, { body: 'Look at this.\n\n![shot.png](/boards/major/shot.png)' });
        expect(panelSource()).toHaveValue('Look at this.\n\n![shot.png](/boards/major/shot.png)');
    });

    it('makes the link the whole body of a flow node with nothing in it yet', () => {
        editorMade.announced = false;
        showing(flowNode('Write the plan', ''));
        render(<Faces />);

        act(() => paste.insert('![shot.png](/boards/major/shot.png)'));

        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, { body: '![shot.png](/boards/major/shot.png)' });
    });
});

describe('FlowNodePanel — the template the flow node is written from', () => {
    beforeEach(() => { templateFolder.answers = true; });

    it('offers the store’s templates, the one the card’s type names picked', async () => {
        render(<Faces />);
        const button = screen.getByRole('button', { name: 'Instantiate template' });
        const archive = screen.getByRole('button', { name: 'Archive node' });
        expect(button.parentElement).toBe(archive.parentElement);
        expect(button.compareDocumentPosition(archive) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByRole('combobox', { name: 'Template' })).toBeNull();

        const menu = await openTemplates();
        expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['AI', 'Bug report', 'Human']);
        expect(within(menu).getByRole('menuitem', { name: 'Human' })).toHaveClass('ant-dropdown-menu-item-selected');
        expect(screen.queryByTestId('central-panel-template-instantiation')).toBeNull();
        expect(board.editFlowNode).not.toHaveBeenCalled();
    });

    it('opens a card that is already Claude’s on the AI template', async () => {
        showing(flowNode('Write the plan', 'lead', { model: 'opus' }));
        render(<Faces />);

        const menu = await openTemplates();
        expect(within(menu).getByRole('menuitem', { name: 'AI' })).toHaveClass('ant-dropdown-menu-item-selected');
    });

    it('takes one picked by hand, and goes back to the type’s on the next flow node', async () => {
        const { rerender } = render(<Faces />);
        await chooseTemplate('Bug report');
        expect(screen.getByTestId('template-instantiation')).toHaveTextContent('Bug report.temp.md');
        expect(board.editFlowNode).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('central-panel-template-instantiation-close'));

        showing({ ...flowNode('Ship it', ''), id: FLOW_NODE_ID });
        board.openingId = 2;
        rerender(<Faces />);
        const menu = await openTemplates();
        expect(within(menu).getByRole('menuitem', { name: 'Human' })).toHaveClass('ant-dropdown-menu-item-selected');
    });

    it('replaces the description with what the template makes', async () => {
        render(<Faces />);
        openOptions();
        await chooseTemplate('Bug report');
        expect(screen.getByTestId('central-panel-template-instantiation')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('template-instantiation'));

        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, { body: '### Steps\n\nDo it.' });
        openSpec();
        expect(panelSource()).toHaveValue('### Steps\n\nDo it.');
        expect(screen.queryByTestId('central-panel-template-instantiation')).toBeNull();
    });

    it.each([
        ['document', 'document-central', 'board-central'],
        ['hybridflow-ui-board', 'board-central', 'document-central'],
    ])('opens the instantiation in the central panel showing (%s), and closing returns there', async (active, shown, hidden) => {
        toolBars.activeCenter = active;
        render(<HostedFaces />);
        await chooseTemplate('Human');

        expect(within(screen.getByTestId(shown)).getByTestId('central-panel-template-instantiation')).toBeInTheDocument();
        expect(within(screen.getByTestId(hidden)).queryByTestId('central-panel-template-instantiation')).toBeNull();

        fireEvent.click(screen.getByTestId('central-panel-template-instantiation-close'));

        expect(screen.queryByTestId('central-panel-template-instantiation')).toBeNull();
        expect(screen.getByTestId(shown)).toBeInTheDocument();
        expect(screen.getByTestId('flow-node-panel')).toBeInTheDocument();
    });

});

describe('FlowNodePanel — what comes after the flow node', () => {
    beforeEach(() => {
        showing(flowNode('Write the plan', 'lead', { model: 'opus' }), other('flow-node-2', 'Ship it'));
    });

    it('offers the board’s other cards, and not the flow node itself', () => {
        renderOptions();
        fireEvent.mouseDown(document.querySelector('.ant-select[aria-label="On success"] .ant-select-content')!);

        expect(document.querySelector('.ant-select-item-option[title="Ship it"]')).not.toBeNull();
        expect(document.querySelector('.ant-select-item-option[title="Write the plan"]')).toBeNull();
    });

    it('writes the flow node it names onto the flow node', () => {
        renderOptions();
        choose('On success', 'Ship it');
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            onSuccess: { flowNode: 'flow-node-2', flowNodes: [], mode: 'end', compact: false },
        });
    });

    // Nothing next is what a flow node says by saying nothing — and only that: what becomes of the chat
    it('takes the id out when it goes back to nothing next, and leaves the rest', () => {
        showing(
            {
                ...flowNode('Write the plan', 'lead', { model: 'opus' }),
                onSuccess: { flowNode: 'flow-node-2', flowNodes: [], mode: 'continue', compact: true },
            },
            other('flow-node-2', 'Ship it'),
        );
        renderOptions();
        choose('On success', 'Nothing next');
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            onSuccess: { flowNode: '', flowNodes: [], mode: 'continue', compact: true },
        });
    });

    it.each([
        ['Continue', 'continue', 'end'],
        ['End conversation', 'end', 'continue'],
    ] as const)('writes %s as the transition mode', (label, value, before) => {
        showing(
            {
                ...flowNode('Write the plan', 'lead', { model: 'opus' }),
                onSuccess: { flowNode: 'flow-node-2', flowNodes: [], mode: before, compact: false },
            },
            other('flow-node-2', 'Ship it'),
        );
        renderOptions();
        choose('Transition mode', label);
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            onSuccess: { flowNode: 'flow-node-2', flowNodes: [], mode: value, compact: false },
        });
    });

    // The compaction is a box of its own because it answers its own question: a card may shorten
    it('writes the compaction beside whatever the mode says', () => {
        showing(
            {
                ...flowNode('Write the plan', 'lead', { model: 'opus' }),
                onSuccess: { flowNode: 'flow-node-2', flowNodes: [], mode: 'end', compact: false },
            },
            other('flow-node-2', 'Ship it'),
        );
        renderOptions();
        fireEvent.click(screen.getAllByTestId('flow-node-compact')[0]);
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            onSuccess: { flowNode: 'flow-node-2', flowNodes: [], mode: 'end', compact: true },
        });
    });

    it('asks about the chat while nothing comes next', () => {
        showing(flowNode('Write the plan', 'lead', { model: 'opus' }));
        renderOptions();
        expect(document.querySelector('.ant-select[aria-label="Transition mode"].ant-select-disabled'))
            .toBeNull();
        choose('Transition mode', 'Continue');
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            onSuccess: { flowNode: '', flowNodes: [], mode: 'continue', compact: false },
        });
    });

    it('asks about the compaction while nothing comes next', () => {
        showing(flowNode('Write the plan', 'lead', { model: 'opus' }));
        renderOptions();
        fireEvent.click(screen.getAllByTestId('flow-node-compact')[0]);
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            onSuccess: { flowNode: '', flowNodes: [], mode: 'end', compact: true },
        });
    });

    it('names the flow node that comes next whoever plays the card', () => {
        showing(flowNode('Write the plan', 'lead'), other('flow-node-2', 'Ship it'));
        renderOptions();

        expect(document.querySelector('.ant-select[aria-label="On success"].ant-select-disabled')).toBeNull();
        choose('On success', 'Ship it');
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            onSuccess: { flowNode: 'flow-node-2', flowNodes: [], mode: 'end', compact: false },
        });
    });

    it('does not ask the mode of a Human flow node, and asks it the chain all the same', () => {
        showing(flowNode('Write the plan', 'lead'), other('flow-node-2', 'Ship it'));
        renderOptions();
        expect(document.querySelector('.ant-select[aria-label="Transition mode"]')).toBeNull();
        expect(document.querySelector('.ant-select[aria-label="On success"]')).not.toBeNull();
    });

    // is a plan, not an error — and it is marked where the settings cannot honour it.
    it('marks a mode the settings of an AI flow node cannot honour', () => {
        showing(
            {
                ...flowNode('Write the plan', 'lead', { model: 'opus' }),
                onSuccess: { flowNode: '', flowNodes: [], mode: 'continue', compact: false },
            },
            other('flow-node-2', 'Ship it'),
        );
        renderOptions();
        const box = document.querySelector('.ant-select[aria-label="Transition mode"]')!;
        expect(box.className).not.toContain('ant-select-disabled');
        expect(box.className).toContain('ant-select-status-warning');
    });

    it('leaves the mode that claims nothing unmarked', () => {
        showing(flowNode('Write the plan', 'lead', { model: 'opus' }), other('flow-node-2', 'Ship it'));
        renderOptions();
        expect(document.querySelector('.ant-select[aria-label="Transition mode"]')!.className)
            .not.toContain('ant-select-status-warning');
    });

    // other direction: it is marked where the settings cannot honour it.
    it('marks a compaction the settings of an AI flow node cannot honour', () => {
        showing(
            {
                ...flowNode('Write the plan', 'lead', { model: 'opus' }),
                onSuccess: { flowNode: '', flowNodes: [], mode: 'end', compact: true },
            },
            other('flow-node-2', 'Ship it'),
        );
        renderOptions();
        expect(screen.getAllByTestId('flow-node-compact')[0].closest('label')!.className)
            .toContain(styles.metaCheckBroken);
    });

    it('is not offered at all where Claude is off', () => {
        config.chatEnabled = false;
        renderOptions();
        expect(screen.queryByTestId('flow-node-success')).toBeNull();
    });
});

describe('FlowNodePanel — the tags the flow node is filed under', () => {
    const picker = () => screen.getAllByTestId('flow-node-tags')[0];

    it('shows the words the flow node carries', () => {
        showing({ ...flowNode('Write the plan', 'lead'), tags: ['bug'] });
        renderOptions();
        expect(picker()).toHaveTextContent('bug');
    });

    it('is asked of every flow node, Claude’s or not', () => {
        config.chatEnabled = false;
        renderOptions();
        expect(screen.queryByTestId('flow-node-tags')).not.toBeNull();
    });
});


describe('FlowNodePanel — the state a play writes onto the flow node', () => {
    it('changes status from the tab bar, to the left of templates', async () => {
        showing({ ...flowNode('Write the plan', 'lead'), status: 'error' });
        render(<Faces />);

        const button = screen.getByRole('button', { name: 'Status' });
        const templates = screen.getByRole('button', { name: 'Instantiate template' });
        expect(button).toHaveAttribute('data-status', 'error');
        expect(button.parentElement).toBe(templates.parentElement);
        expect(button.nextElementSibling).toBe(templates);
        expect(button.closest('.ant-tabs-nav')).not.toBeNull();
        fireEvent.click(button);
        const menu = await screen.findByRole('menu');
        expect(within(menu).getByRole('menuitem', { name: 'Error' })).toHaveClass('ant-dropdown-menu-item-selected');
        fireEvent.click(within(menu).getByRole('menuitem', { name: 'Ready' }));

        expect(board.setFlowNodeStatus).toHaveBeenCalledWith(FLOW_NODE_ID, 'ready');
        openOptions();
        expect(within(screen.getByRole('tabpanel', { name: 'Options' }))
            .queryByTestId('flow-node-status')).toBeNull();
        expect(screen.getAllByRole('button', { name: 'Status' })).toHaveLength(1);
    });

    it('offers every status with a symbol and its card border colour', async () => {
        showing({ ...flowNode('Write the plan', 'lead'), status: 'error' });
        render(<Faces />);

        fireEvent.click(screen.getByRole('button', { name: 'Status' }));
        const menu = await screen.findByRole('menu');
        const items = within(menu).getAllByRole('menuitem');
        expect(items.map(item => {
            const tone = item.querySelector<HTMLElement>(`.${styles.statusTone}`)!;
            expect(within(tone).getByRole('img', { hidden: true })).toBeInTheDocument();
            return [tone.dataset.status, item.textContent];
        })).toEqual([
            ['draft', 'Draft'], ['ready', 'Ready'], ['todo', 'To do'], ['blocked', 'Blocked'],
            ['running', 'In progress'], ['waiting-refresh', 'Waiting refresh'],
            ['interrupted', 'Interrupted'], ['done', 'Done'], ['error', 'Error'],
        ]);
    });

    it.each(['scheduler', 'gateway', 'shutdown'])('keeps status editing on a %s node', async type => {
        showing({ ...flowNode('A node', ''), type } as any);
        render(<Faces />);
        fireEvent.click(screen.getByRole('button', { name: 'Status' }));
        const menu = await screen.findByRole('menu');
        fireEvent.click(within(menu).getByRole('menuitem', { name: 'Blocked' }));
        expect(board.setFlowNodeStatus).toHaveBeenCalledWith(FLOW_NODE_ID, 'blocked');
    });

    it('offers it whether or not Claude is part of the build', () => {
        config.chatEnabled = false;
        render(<Faces />);
        expect(screen.getByRole('button', { name: 'Status' })).not.toBeDisabled();
    });

    it('says a flow node has no chat until it has been played', () => {
        showing(flowNode('Write the plan', 'lead', { model: 'opus' }));
        renderOptions();
        expect(screen.getByTestId('flow-node-state')).toHaveTextContent('No chat yet');
        expect(screen.queryByTestId('open-flow-node-chat')).toBeNull();
    });

    it('says nothing about a chat on a Human flow node', () => {
        renderOptions();
        expect(screen.queryByTestId('flow-node-state')).toBeNull();
        expect(screen.queryByTestId('open-flow-node-chat')).toBeNull();
    });

    it('opens the flow node’s chat in the panel it is watched in', () => {
        showing({ ...flowNode('Write the plan', 'lead', { model: 'opus' }), chat: 'chat-1' });
        renderOptions();

        fireEvent.click(screen.getByTestId('open-flow-node-chat'));

        expect(show.showConversation).toHaveBeenCalledWith('chat-1');
    });

    it('takes the link off the flow node without touching the chat', () => {
        showing({ ...flowNode('Write the plan', 'lead', { model: 'opus' }), chat: 'chat-1' });
        renderOptions();

        fireEvent.click(screen.getByTestId('unlink-flow-node-chat'));

        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, { chat: '' });
    });

    it('says nothing about a chat where Claude is off', () => {
        config.chatEnabled = false;
        showing({ ...flowNode('Write the plan', 'lead', { model: 'opus' }), chat: 'chat-1' });
        renderOptions();
        expect(screen.queryByTestId('open-flow-node-chat')).toBeNull();
    });
});



