import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from 'src/test/render';

/**
 * The panel and the large editor are one editor with two faces.
 * What matters is that they never become two: one draft of the flow node above both.
 */

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

const largeEditor = await vi.hoisted(async () => {
    const { createExternalStore } = await import('src/test/mocks');
    return createExternalStore(false);
});

vi.mock('../Hybridflow-ctx', () => ({
    useHybridflow: () => {
        const [, bump] = React.useReducer((count: number) => count + 1, 0);
        React.useEffect(() => largeEditor.subscribe(bump), []);
        return { ...board, expanded: largeEditor.value, setExpanded: largeEditor.set };
    },
}));
vi.mock('@cms-core', async importOriginal => ({
    ...(await importOriginal<typeof import('@cms-core')>()),
    markdownLinkDrop: [],
    useFileDrop: () => ({ dropping: false, dropProps: {} }),
    RevealInTreeButton: ({ path, 'data-testid': testId }: { path: string | null; 'data-testid'?: string }) =>
        <button type="button" data-testid={testId} disabled={path === null} />,
    useDashboardConfig: () => config,
    useToolBars: () => ({ showTab: toolBars.showTab, activeIn: () => toolBars.activeCenter }),
    useToolBarsOptional: () => ({ showTab: toolBars.showTab, activeIn: () => toolBars.activeCenter }),
    useWorkerClient: () => ({ deleteAgentConversation: vi.fn().mockResolvedValue(undefined) }),
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
    const { agentOptions } = await import('src/test/agents');
    return [agentOptions({
        models: [{ value: 'opus', label: 'Opus' }],
        efforts: [{ value: 'high', label: 'High' }],
        permissionModes: [{ value: 'manualLive', label: 'Manual Live' }],
    })];
});

vi.mock('@cms-kit/capabilities', () => ({
    // Everything the board asks of an agent, as the contract rather than as a plugin: showing the
    useShowChat: () => show.showConversation,
    useChatRunAvailable: () => config.chatEnabled,
    useChatOptions: () => ({
        agents: TEST_AGENTS,
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
            { id: 'agent-1', name: 'Reviewer', platform: 'claude', model: 'opus', published: { platform: 'claude' } },
            { id: 'agent-2', name: 'Runner', platform: 'codex', model: 'gpt-5.1-codex', published: { platform: 'codex' } },
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

const largePaste = vi.hoisted(() => ({
    folder: undefined as string | undefined,
    documentName: undefined as string | undefined,
    linkFromRoot: undefined as boolean | undefined,
}));

vi.mock('@cms-kit/markdown-editor', () => ({
    MarkdownEditorBody: React.forwardRef<
        unknown,
        { value: string; onChange: (v: string) => void; imageFolder?: string; imageDocumentName?: string; imageLinksFromRoot?: boolean }
    >(
        ({ value, onChange, imageFolder, imageDocumentName, imageLinksFromRoot }, _ref) => {
            largePaste.folder = imageFolder;
            largePaste.documentName = imageDocumentName;
            largePaste.linkFromRoot = imageLinksFromRoot;
            return (
                <textarea data-testid="editor-source" value={value} onChange={event => onChange(event.target.value)} />
            );
        },
    ),
    MarkdownEditorToolbar: () => <div data-testid="editor-toolbar" />,
    useMarkdownEditorControls: () => ({ editorRef: { current: null }, bodyProps: {}, toolbarProps: {} }),
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

import { CentralStackProvider, CentralStackView, DOCUMENT_TAB_ID } from '@cms-core';
import { FlowNodePanel } from './FlowNodePanel';
import { ExpandedFlowNode } from './ExpandedFlowNode';
import { BOARD_TAB_ID } from '../constants';
import { FlowNodeEditingProvider } from '../FlowNodeEditing-ctx';
import { noSuccess } from '../flowNodeSuccess';
import styles from '../Hybridflow.module.css';

/** The two faces of one editor, mounted where the plugin mounts them and sharing the one draft. */
const Faces: React.FC<{ panel?: boolean }> = ({ panel = true }) => (
    <CentralStackProvider>
        <FlowNodeEditingProvider>
            {panel && <FlowNodePanel />}
            <ExpandedFlowNode />
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

const expand = () => fireEvent.click(screen.getByTestId('expand-flow-node'));

/** The panel's description box. */
const panelSource = () => within(screen.getByTestId('flow-node-panel')).getByTestId('panel-source');

/** What the panel's template select is showing — the one the card is written from. */
const picked = () => within(screen.getByTestId('flow-node-panel')).getByTestId('flow-node-template');

/** Opens the panel's model select and takes the option named. */
const choose = (label: string, option: string) => {
    fireEvent.mouseDown(document.querySelector(`.ant-select[aria-label="${label}"] .ant-select-content`)!);
    fireEvent.click(document.querySelector(`.ant-select-item-option[title="${option}"]`)!);
};

/** Handing the open flow node to an agent, which is all it takes: the card is typed AI. */
const typeAi = () => { expand(); choose('Node type', 'AI'); };

/** And back: a card typed Human gives up the agent, the effort and the permission mode. */
const typeHuman = () => { expand(); choose('Node type', 'Human'); };

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
    largeEditor.value = false;
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
        for (const label of ['Agent', 'Effort', 'Permission mode', 'Transition mode', 'On success', 'Output type']) {
            expect(ui.getByRole('combobox', { name: label })).toBeDisabled();
        }
        expect(ui.getByLabelText('Working directory')).toHaveAttribute('readonly');
        expect(ui.getByTestId('flow-node-compact')).toBeDisabled();
        expect(ui.getByLabelText('Success criterion')).toHaveAttribute('readonly');
        expect(ui.getByTestId('description-preview')).toHaveTextContent('Original description');
        expect(ui.queryByTestId('flow-node-template')).toBeNull();
        expect(ui.queryByRole('button', { name: 'Add success criterion' })).toBeNull();
        expect(ui.queryByRole('button', { name: 'Remove success criterion' })).toBeNull();
        expect(ui.getByRole('combobox', { name: 'Status' })).not.toBeDisabled();
    };

    it.each(['blocked', 'running', 'waiting-refresh', 'interrupted', 'done', 'error'])(
        'locks task inputs in both editors for %s', status => {
            showing(task(status));
            render(<Faces />);
            expand();
            expectLocked(screen.getByTestId('flow-node-panel'));
            expectLocked(screen.getByTestId('flow-node-editor'));
            expect(screen.queryByTestId('panel-source')).toBeNull();
            expect(screen.queryByTestId('editor-source')).toBeNull();
            fireEvent.keyDown(screen.getAllByLabelText('Success criterion')[0], { key: 'Enter' });
            fireEvent.keyDown(screen.getAllByLabelText('Success criterion')[1], { key: 'Enter', ctrlKey: true });
            fireEvent.change(screen.getAllByLabelText('Success criterion')[0], { target: { value: 'Changed' } });
            fireEvent.change(screen.getAllByLabelText('Working directory')[0], { target: { value: '/changed' } });
            expect(board.editFlowNode).not.toHaveBeenCalled();
        },
    );

    it.each(['draft', 'ready'])('unlocks both editors when the task becomes %s', status => {
        showing(task('running'));
        const { rerender } = render(<Faces />);
        expand();
        showing(task(status));
        rerender(<Faces />);
        for (const face of [screen.getByTestId('flow-node-panel'), screen.getByTestId('flow-node-editor')]) {
            const ui = within(face);
            expect(ui.getByRole('combobox', { name: 'Agent' })).not.toBeDisabled();
            expect(ui.getByLabelText('Working directory')).not.toHaveAttribute('readonly');
            expect(ui.getByLabelText('Success criterion')).not.toHaveAttribute('readonly');
            expect(ui.getByTestId('flow-node-template')).toBeInTheDocument();
            expect(ui.getByRole('button', { name: 'Add success criterion' })).toBeInTheDocument();
        }
        fireEvent.change(panelSource(), { target: { value: 'Updated description' } });
        expect(screen.getByTestId('editor-source')).toHaveValue('Updated description');
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, { body: 'Updated description' });
    });

    it('locks an already open editor when a task starts', () => {
        showing(task('ready'));
        const { rerender } = render(<Faces />);
        expand();
        showing(task('running'));
        rerender(<Faces />);
        expectLocked(screen.getByTestId('flow-node-panel'));
        expectLocked(screen.getByTestId('flow-node-editor'));
    });

    it('blocks a template opened before the task started from replacing its description', async () => {
        templateFolder.answers = true;
        showing(task('ready'));
        const { rerender } = render(<Faces />);
        await waitFor(() => expect(screen.getByTestId('instantiate-template')).not.toBeDisabled());
        fireEvent.click(screen.getByTestId('instantiate-template'));
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
        expand();
        for (const output of screen.getAllByRole('combobox', { name: 'Output type' })) {
            expect(output).toBeDisabled();
        }
        expect(screen.getAllByTestId('description-preview')).toHaveLength(2);
        expect(screen.queryByTestId('flow-node-template')).toBeNull();
        expect(screen.queryByTestId('flow-node-criteria-add')).toBeNull();
    });

    it('keeps Human tasks editable after completion', () => {
        showing(task('done', 'human'));
        render(<Faces />);
        expand();
        expect(panelSource()).toHaveValue('Original description');
        expect(screen.getByTestId('editor-source')).toHaveValue('Original description');
        expect(screen.getAllByTestId('flow-node-criteria-add')).toHaveLength(2);
        expect(screen.getAllByTestId('flow-node-template')).toHaveLength(2);
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

    it('writes a setting onto the settings the flow node holds', () => {
        showing(flowNode('Write the plan', 'lead', { effort: 'high' }));
        render(<Faces />);

        typeAi();

        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            settings: { effort: 'high', agent: 'agent-1' },
            type: 'ai',
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

    it('offers the large editor the same folder, and the same link from the store root', () => {
        render(<Faces />);
        expand();

        expect(largePaste.folder).toBe('boards/major');
        expect(largePaste.documentName).toBe('major');
        expect(largePaste.linkFromRoot).toBe(true);
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

/** The template a card is written from**: one of the store's `. temp. */
describe('FlowNodePanel — the template the flow node is written from', () => {
    beforeEach(() => { templateFolder.answers = true; });

    it('writes the settings and the type, and leaves the description alone', async () => {
        render(<Faces />);
        await waitFor(() => expect(picked()).toHaveTextContent('Human'));

        typeAi();

        expect(board.editFlowNode).toHaveBeenCalledTimes(1);
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            settings: { agent: 'agent-1' },
            type: 'ai',
        });
        expect(panelSource()).toHaveValue('lead');
    });

    it('offers the store’s templates, the one the card’s type names picked', async () => {
        render(<Faces />);
        await waitFor(() => expect(picked()).toHaveTextContent('Human'));

        typeAi();
        expect(picked()).toHaveTextContent('AI');
    });

    it('opens a card that is already Claude’s on the AI template', async () => {
        showing(flowNode('Write the plan', 'lead', { model: 'opus' }));
        render(<Faces />);

        await waitFor(() => expect(picked()).toHaveTextContent('AI'));
    });

    it('takes one picked by hand, and goes back to the type’s on the next flow node', async () => {
        const { rerender } = render(<Faces />);
        await waitFor(() => expect(picked()).toHaveTextContent('Human'));

        choose('Template', 'Bug report');
        expect(picked()).toHaveTextContent('Bug report');

        showing({ ...flowNode('Ship it', ''), id: FLOW_NODE_ID });
        board.openingId = 2;
        rerender(<Faces />);
        expect(picked()).toHaveTextContent('Human');
    });

    it('replaces the description with what the template makes', async () => {
        render(<Faces />);
        await waitFor(() => expect(picked()).toHaveTextContent('Human'));

        fireEvent.click(within(screen.getByTestId('flow-node-panel')).getByTestId('instantiate-template'));
        expect(screen.getByTestId('central-panel-template-instantiation')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('template-instantiation'));

        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, { body: '### Steps\n\nDo it.' });
        expect(panelSource()).toHaveValue('### Steps\n\nDo it.');
        expect(screen.queryByTestId('central-panel-template-instantiation')).toBeNull();
    });

    it.each([
        ['document', 'document-central', 'board-central'],
        ['hybridflow-ui-board', 'board-central', 'document-central'],
    ])('opens the instantiation in the central panel showing (%s), and closing returns there', async (active, shown, hidden) => {
        toolBars.activeCenter = active;
        render(<HostedFaces />);
        await waitFor(() => expect(picked()).toHaveTextContent('Human'));

        fireEvent.click(within(screen.getByTestId('flow-node-panel')).getByTestId('instantiate-template'));

        expect(within(screen.getByTestId(shown)).getByTestId('central-panel-template-instantiation')).toBeInTheDocument();
        expect(within(screen.getByTestId(hidden)).queryByTestId('central-panel-template-instantiation')).toBeNull();

        fireEvent.click(screen.getByTestId('central-panel-template-instantiation-close'));

        expect(screen.queryByTestId('central-panel-template-instantiation')).toBeNull();
        expect(screen.getByTestId(shown)).toBeInTheDocument();
        expect(screen.getByTestId('flow-node-panel')).toBeInTheDocument();
    });

    it('is the same pick in the large editor, which writes the same flow node', async () => {
        render(<Faces />);
        await waitFor(() => expect(picked()).toHaveTextContent('Human'));
        typeAi();
        expand();

        const editor = screen.getByTestId('flow-node-editor');
        expect(within(editor).getByTestId('flow-node-template')).toHaveTextContent('AI');

        fireEvent.click(within(editor).getByTestId('instantiate-template'));
        expect(screen.getByTestId('central-panel-template-instantiation')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('template-instantiation'));

        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, { body: '### Steps\n\nDo it.' });
        expect(panelSource()).toHaveValue('### Steps\n\nDo it.');
        expect(screen.queryByTestId('central-panel-template-instantiation')).toBeNull();
        expect(screen.getByTestId('flow-node-editor')).toBeInTheDocument();
    });

    it('pushes over the large editor, and cancelling is back in it', async () => {
        render(<Faces />);
        await waitFor(() => expect(picked()).toHaveTextContent('Human'));
        expand();

        fireEvent.click(within(screen.getByTestId('flow-node-editor')).getByTestId('instantiate-template'));
        expect(screen.getByTestId('central-panel-template-instantiation')).toBeInTheDocument();
        expect(screen.getByTestId('central-panel-flow-node-editor')).toHaveAttribute('hidden');

        fireEvent.click(screen.getByTestId('central-panel-template-instantiation-close'));

        expect(screen.queryByTestId('central-panel-template-instantiation')).toBeNull();
        expect(screen.getByTestId('flow-node-editor')).toBeInTheDocument();
        expect(board.editFlowNode).not.toHaveBeenCalled();
    });
});

describe('The large editor over the board', () => {
    it('keeps the editor shut until it is asked for', () => {
        render(<Faces />);
        expect(screen.queryByTestId('flow-node-editor')).toBeNull();
    });

    it('opens the flow node in the editor, as the panel holds it', () => {
        render(<Faces />);
        expand();

        expect(toolBars.showTab).toHaveBeenCalledWith(BOARD_TAB_ID);
        expect(screen.getByTestId('flow-node-editor')).toBeInTheDocument();
        expect(screen.getByTestId('editor-source')).toHaveValue('lead');
        expect(screen.getByTestId('flow-node-editor-title')).toHaveValue('Write the plan');
        expect(screen.getByTestId('editor-toolbar')).toBeInTheDocument();
    });

    it('places criteria below the description', () => {
        render(<Faces />);
        expand();

        const editor = screen.getByTestId('flow-node-editor');
        const description = within(editor).getByTestId('editor-source');
        const criteria = within(editor).getByTestId('flow-node-criteria');
        expect(description.compareDocumentPosition(criteria) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('holds the title on its first row', () => {
        render(<Faces />);
        expand();

        const editor = screen.getByTestId('flow-node-editor');
        const box = screen.getByTestId('flow-node-editor-title');
        expect(box).toHaveValue('Write the plan');
        expect(editor.firstElementChild).toContainElement(box);

        fireEvent.change(box, { target: { value: 'Renamed' } });
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, { title: 'Renamed' });
        expect(screen.getByTestId('flow-node-title')).toHaveValue('Renamed');
    });

    it('lays the flow node’s own controls across its rows', () => {
        showing(
            { ...flowNode('Write the plan', 'lead', { model: 'opus' }), chat: 'chat-1' },
            other('flow-node-2', 'Ship it'),
        );
        render(<Faces />);
        expand();

        const editor = screen.getByTestId('flow-node-editor');
        const labels = [
            'Working directory', 'Agent', 'Effort', 'Permission mode', 'Transition mode',
            'Status', 'On success',
        ];
        expect(labels.filter(label => editor.querySelector(`[aria-label="${label}"]`))).toEqual(labels);
        expect(editor.querySelector('[data-testid="open-flow-node-chat"]')).not.toBeNull();
    });

    it('writes what is typed in the editor to the board and to the panel', () => {
        render(<Faces />);
        expand();

        fireEvent.change(screen.getByTestId('editor-source'), { target: { value: 'more' } });

        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, { body: 'more' });
        expect(panelSource()).toHaveValue('more');
    });

    it('shows the settings in the editor, written onto the same flow node', () => {
        showing(flowNode('Write the plan', 'lead', { agent: 'agent-1' }));
        render(<Faces />);
        expand();

        const agent = document.querySelectorAll('.ant-select[aria-label="Agent"]');
        expect(agent).toHaveLength(2);

        fireEvent.mouseDown(agent[1].querySelector('.ant-select-content')!);
        fireEvent.click(document.querySelector('.ant-select-item-option[title="Runner"]')!);

        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            settings: { agent: 'agent-2' },
        });
    });

    it('opens as a panel on the stack, the panel behind it staying on screen', () => {
        render(<Faces />);
        expand();

        const stack = screen.getByTestId('central-panel-flow-node-editor');
        expect(stack).toHaveAttribute('role', 'dialog');
        expect(stack).toContainElement(screen.getByTestId('flow-node-editor'));
        expect(screen.getByTestId('flow-node-panel')).toBeInTheDocument();
    });

    it('closes back onto the board through the floating cross', () => {
        render(<Faces />);
        expand();
        fireEvent.click(screen.getByTestId('central-panel-flow-node-editor-close'));

        expect(screen.queryByTestId('flow-node-editor')).toBeNull();
        expect(largeEditor.value).toBe(false);
    });

    it('stays open, and keeps what is typed, when the panel’s column is hidden', () => {
        const { rerender } = render(<Faces />);
        expand();
        fireEvent.change(screen.getByTestId('editor-source'), { target: { value: 'half a sen' } });

        rerender(<Faces panel={false} />);

        expect(screen.queryByTestId('flow-node-panel')).toBeNull();
        expect(screen.getByTestId('flow-node-editor')).toBeInTheDocument();
        expect(screen.getByTestId('editor-source')).toHaveValue('half a sen');
        expect(screen.getByTestId('flow-node-editor-title')).toHaveValue('Write the plan');
    });

    it('hands the panel what was typed while its column was away', () => {
        const { rerender } = render(<Faces />);
        expand();
        rerender(<Faces panel={false} />);

        fireEvent.change(screen.getByTestId('editor-source'), { target: { value: 'typed alone' } });
        rerender(<Faces />);

        expect(panelSource()).toHaveValue('typed alone');
    });

    it('offers no settings in the editor where Claude is off', () => {
        config.chatEnabled = false;
        render(<Faces />);
        expand();

        expect(screen.getByTestId('flow-node-editor')).toBeInTheDocument();
        expect(screen.queryByTestId('flow-node-meta')).toBeNull();
    });
});


describe('FlowNodePanel — what comes after the flow node', () => {
    beforeEach(() => {
        showing(flowNode('Write the plan', 'lead', { model: 'opus' }), other('flow-node-2', 'Ship it'));
    });

    it('offers the board’s other cards, and not the flow node itself', () => {
        render(<Faces />);
        fireEvent.mouseDown(document.querySelector('.ant-select[aria-label="On success"] .ant-select-content')!);

        expect(document.querySelector('.ant-select-item-option[title="Ship it"]')).not.toBeNull();
        expect(document.querySelector('.ant-select-item-option[title="Write the plan"]')).toBeNull();
    });

    it('writes the flow node it names onto the flow node', () => {
        render(<Faces />);
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
        render(<Faces />);
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
        render(<Faces />);
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
        render(<Faces />);
        fireEvent.click(screen.getAllByTestId('flow-node-compact')[0]);
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            onSuccess: { flowNode: 'flow-node-2', flowNodes: [], mode: 'end', compact: true },
        });
    });

    it('asks about the chat while nothing comes next', () => {
        showing(flowNode('Write the plan', 'lead', { model: 'opus' }));
        render(<Faces />);
        expect(document.querySelector('.ant-select[aria-label="Transition mode"].ant-select-disabled'))
            .toBeNull();
        choose('Transition mode', 'Continue');
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            onSuccess: { flowNode: '', flowNodes: [], mode: 'continue', compact: false },
        });
    });

    it('asks about the compaction while nothing comes next', () => {
        showing(flowNode('Write the plan', 'lead', { model: 'opus' }));
        render(<Faces />);
        fireEvent.click(screen.getAllByTestId('flow-node-compact')[0]);
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            onSuccess: { flowNode: '', flowNodes: [], mode: 'end', compact: true },
        });
    });

    it('names the flow node that comes next whoever plays the card', () => {
        showing(flowNode('Write the plan', 'lead'), other('flow-node-2', 'Ship it'));
        render(<Faces />);

        expect(document.querySelector('.ant-select[aria-label="On success"].ant-select-disabled')).toBeNull();
        choose('On success', 'Ship it');
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            onSuccess: { flowNode: 'flow-node-2', flowNodes: [], mode: 'end', compact: false },
        });
    });

    it('does not ask the mode of a Human flow node, and asks it the chain all the same', () => {
        showing(flowNode('Write the plan', 'lead'), other('flow-node-2', 'Ship it'));
        render(<Faces />);
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
        render(<Faces />);
        const box = document.querySelector('.ant-select[aria-label="Transition mode"]')!;
        expect(box.className).not.toContain('ant-select-disabled');
        expect(box.className).toContain('ant-select-status-warning');
    });

    it('leaves the mode that claims nothing unmarked', () => {
        showing(flowNode('Write the plan', 'lead', { model: 'opus' }), other('flow-node-2', 'Ship it'));
        render(<Faces />);
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
        render(<Faces />);
        expect(screen.getAllByTestId('flow-node-compact')[0].closest('label')!.className)
            .toContain(styles.metaCheckBroken);
    });

    // What becomes of the chat is something only a played card can mean, so a card typed back to
    it('gives what it said about the chat up with the settings when the card is typed Human', () => {
        showing({
            ...flowNode('Write the plan', 'lead', { model: 'opus', effort: 'high' }),
            onSuccess: { flowNode: 'flow-node-2', flowNodes: [], mode: 'continue', compact: true },
        }, other('flow-node-2', 'Ship it'));
        render(<Faces />);

        typeHuman();

        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            settings: {},
            type: 'human',
            onSuccess: { flowNode: 'flow-node-2', flowNodes: [], mode: 'end', compact: false },
        });
    });

    it('takes the chain off a card typed Shutdown, and stops asking about what follows it', () => {
        showing({
            ...flowNode('Write the plan', 'lead', { model: 'opus', effort: 'high' }),
            onSuccess: { flowNode: 'flow-node-2', flowNodes: [], mode: 'continue', compact: true },
        }, other('flow-node-2', 'Ship it'));
        const { rerender } = render(<Faces />);

        expand();
        choose('Node type', 'Shutdown');
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            settings: {},
            type: 'shutdown',
            criteria: [],
            complexity: null,
            onSuccess: { flowNode: '', flowNodes: [], mode: 'end', compact: false },
        });

        showing({ ...flowNode('Write the plan', 'lead'), type: 'shutdown' }, other('flow-node-2', 'Ship it'));
        rerender(<Faces />);
        expect(screen.queryByTestId('flow-node-success')).toBeNull();
    });

    it('is the same field in the large editor', () => {
        render(<Faces />);
        expand();
        expect(document.querySelectorAll('.ant-select[aria-label="On success"]')).toHaveLength(2);
    });

    it('is not offered at all where Claude is off', () => {
        config.chatEnabled = false;
        render(<Faces />);
        expect(screen.queryByTestId('flow-node-success')).toBeNull();
    });
});

describe('FlowNodePanel — the tags the flow node is filed under', () => {
    const picker = () => screen.getAllByTestId('flow-node-tags')[0];

    it('shows the words the flow node carries', () => {
        showing({ ...flowNode('Write the plan', 'lead'), tags: ['bug'] });
        render(<Faces />);
        expect(picker()).toHaveTextContent('bug');
    });

    it('is asked of every flow node, Claude’s or not', () => {
        config.chatEnabled = false;
        render(<Faces />);
        expect(screen.queryByTestId('flow-node-tags')).not.toBeNull();
    });

    it('is the same field in the large editor', () => {
        render(<Faces />);
        expand();
        expect(screen.getAllByTestId('flow-node-tags')).toHaveLength(2);
    });
});


describe('FlowNodePanel — the state a play writes onto the flow node', () => {
    it('shows where the flow node stands, and sets it back', () => {
        showing({ ...flowNode('Write the plan', 'lead'), status: 'error' });
        render(<Faces />);

        expect(document.querySelector('.ant-select[aria-label="Status"]')).not.toBeNull();
        choose('Status', 'Ready');
        expect(board.setFlowNodeStatus).toHaveBeenCalledWith(FLOW_NODE_ID, 'ready');
    });

    it('names each status in its card border colour', () => {
        showing({ ...flowNode('Write the plan', 'lead'), status: 'error' });
        render(<Faces />);

        fireEvent.mouseDown(document.querySelector('.ant-select[aria-label="Status"] .ant-select-content')!);
        const tones = Array.from(document.querySelectorAll<HTMLElement>(
            `.ant-select-item-option .${styles.statusTone}`,
        ));
        expect(tones.map(tone => [tone.dataset.status, tone.textContent])).toEqual([
            ['draft', 'Draft'], ['ready', 'Ready'], ['todo', 'To do'], ['blocked', 'Blocked'],
            ['running', 'In progress'], ['waiting-refresh', 'Waiting refresh'],
            ['interrupted', 'Interrupted'], ['done', 'Done'], ['error', 'Error'],
        ]);
    });

    it('offers it whether or not Claude is part of the build', () => {
        config.chatEnabled = false;
        render(<Faces />);
        expect(screen.getByTestId('flow-node-state')).toBeInTheDocument();
    });

    it('says a flow node has no chat until it has been played', () => {
        showing(flowNode('Write the plan', 'lead', { model: 'opus' }));
        render(<Faces />);
        expect(screen.getByTestId('flow-node-state')).toHaveTextContent('No chat yet');
        expect(screen.queryByTestId('open-flow-node-chat')).toBeNull();
    });

    it('says nothing about a chat on a Human flow node', () => {
        render(<Faces />);
        expect(screen.getByTestId('flow-node-state')).not.toHaveTextContent('No chat yet');
        expect(screen.queryByTestId('open-flow-node-chat')).toBeNull();
    });

    it('opens the flow node’s chat in the panel it is watched in', () => {
        showing({ ...flowNode('Write the plan', 'lead', { model: 'opus' }), chat: 'chat-1' });
        render(<Faces />);

        fireEvent.click(screen.getByTestId('open-flow-node-chat'));

        expect(show.showConversation).toHaveBeenCalledWith('chat-1');
    });

    it('takes the link off the flow node without touching the chat', () => {
        showing({ ...flowNode('Write the plan', 'lead', { model: 'opus' }), chat: 'chat-1' });
        render(<Faces />);

        fireEvent.click(screen.getByTestId('unlink-flow-node-chat'));

        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, { chat: '' });
    });

    it('says nothing about a chat where Claude is off', () => {
        config.chatEnabled = false;
        showing({ ...flowNode('Write the plan', 'lead', { model: 'opus' }), chat: 'chat-1' });
        render(<Faces />);
        expect(screen.queryByTestId('open-flow-node-chat')).toBeNull();
    });
});



