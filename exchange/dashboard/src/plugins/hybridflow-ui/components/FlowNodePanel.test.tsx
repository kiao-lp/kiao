import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from 'src/test/render';

/**
 * The panel and the large editor are one editor with two faces. What matters is that they never
 * become two: one draft of the flow node above both (`FlowNodeEditing-ctx`), and a keystroke in either
 * landing on the board through the same call.
 *
 * They are mounted the way the plugin mounts them — the panel in a tool bar, the large editor in
 * the central area — because that is the thing being tested as much as the writes are: hiding the
 * right column takes the panel away, and must not take the editor over the board with it.
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
const toolBars = vi.hoisted(() => ({ showTab: vi.fn() }));

const config = vi.hoisted(() => ({ chatEnabled: true }));

/**
 * The store's `flow-node-templates` folder, as the editor reads it — and **when** it answers. A folder
 * that answers a test which never waited for it is a state update landing after that test has
 * ended, so it answers only where the templates are the subject; everywhere else the select is a
 * select whose folder has not come back yet, which is a real moment of the panel's life.
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

// Whether the large editor is open is the board's state, not the panel's — the board opens it too,
// on a double-clicked card, and the central area reads the same answer the panel's expand button
// writes. A state per consumer would be two editors blind to each other, so this stands the
// provider in as the one place holding it.
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
    // The central stack is the real one: the large editor and the instantiation are pushed onto
    // it the way the layout draws it. Everything else below is stood in.
    ...(await importOriginal<typeof import('@cms-core')>()),
    // A file dragged out of the tree into the body or the folder box is markdownLinkDrop.test's
    // subject and useFileDrop.test's, not this one's.
    markdownLinkDrop: [],
    useFileDrop: () => ({ dropping: false, dropProps: {} }),
    // The crosshair at the end of the folder box. Where it takes the navigation tree is
    // FileTree-cmp's own test; what this one reads off it is whether there is a folder to show.
    RevealInTreeButton: ({ path, 'data-testid': testId }: { path: string | null; 'data-testid'?: string }) =>
        <button type="button" data-testid={testId} disabled={path === null} />,
    useDashboardConfig: () => config,
    useToolBars: () => toolBars,
    useWorkerClient: () => ({ deleteAgentConversation: vi.fn().mockResolvedValue(undefined) }),
    // The archive button writes a file beside the board, which is a change to the store the tree
    // is told about. Its own test watches that; here it is one more thing the panel may call.
    useRefreshFileList: () => vi.fn(),
    extractName: (path: string) => path.slice(path.lastIndexOf('/') + 1),
    parentPath: (path: string) => (path.lastIndexOf('/') === 0 ? '/' : path.slice(0, path.lastIndexOf('/'))),
    CodeMirrorTextEditor: ({ value, onChange, onEditor }: {
        value: string; onChange: (v: string) => void; onEditor?: (view: any) => void;
    }) => {
        const box = React.useRef<HTMLTextAreaElement>(null);
        const held = React.useRef(value);
        held.current = value;
        // The editor CodeMirror hands over once it has made one. The panel asks two things of it —
        // what text it is showing, and the caret — and the box standing in has both.
        React.useEffect(() => {
            if (!editorMade.announced) return;
            onEditor?.({
                focus: () => box.current?.focus(),
                dispatch: (spec: any) => { editorMade.dispatched.push(spec); },
                // Both read when they are asked for, as CodeMirror's own are: the editor is handed
                // over a tick before the draft above the panel has reached it, and a length taken
                // then would be the length of an empty box.
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

// One agent, offering one of everything: the panel is asked about the fields, not the catalogues.
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
    // chat a flow node was played in, and the agents its settings are chosen from.
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

// The store's tags: an app-level provider of the `tags` plugin, mocked here as the Claude options
// are — this is the board's test, and a list read out of `kiao-user-config` is not its subject.

// The managed agents the store keeps, two of them on two platforms: what a card typed AI is
// given, and what its effort and permission mode are read against.
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

// Whether the box under the panel has handed its editor over yet. It always has, a moment after
// the panel is on screen — the exception is what the paste fallback is there for.
const editorMade = vi.hoisted(() => ({ announced: true, dispatched: [] as any[] }));

// Both editors are CodeMirror-backed; standing them in keeps the assertions on what travels
// between them rather than on the widget.
// The instantiation panel is the template-lang engine over a file of the store, and it has its own
// tests: what this file is about is which template is offered and where what it makes ends up.
vi.mock('./TemplateInstantiationPanel', () => ({
    TemplateInstantiationPanel: ({ path, onInstantiate }: {
        path: string; onInstantiate: (text: string) => void;
    }) => (
        <button data-testid="template-instantiation" onClick={() => onInstantiate('### Steps\n\nDo it.')}>
            {path}
        </button>
    ),
}));

// What the paste dialog does with a screenshot is its own tests' subject; this one is about what
// the panel hands it and where what comes back lands.
const paste = vi.hoisted(() => ({
    folder: '',
    documentName: '',
    linkFromRoot: false,
    insert: (_snippet: string) => {},
    onPasteCapture: vi.fn(),
    insertBlockAt: vi.fn(),
}));

// What the large editor hands the markdown editor's own paste — the folder the image is offered
// to go in, the name it is made unique from, and whether its link is written from the store root.
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

import { CentralStackProvider, CentralStackView } from '@cms-core';
import { FlowNodePanel } from './FlowNodePanel';
import { ExpandedFlowNode } from './ExpandedFlowNode';
import { BOARD_TAB_ID } from '../constants';
import { FlowNodeEditingProvider } from '../FlowNodeEditing-ctx';
import { noSuccess } from '../flowNodeSuccess';
import styles from '../Hybridflow.module.css';

/**
 * The two faces of one editor, mounted where the plugin mounts them and sharing the one draft.
 * `panel` off is the right column hidden: the tab is unmounted, and nothing else about the page is.
 * The stack is the layout's own, drawn under the faces the way `LayoutContent` draws it.
 */
const Faces: React.FC<{ panel?: boolean }> = ({ panel = true }) => (
    <CentralStackProvider>
        <FlowNodeEditingProvider>
            {panel && <FlowNodePanel />}
            <ExpandedFlowNode />
            <CentralStackView />
        </FlowNodeEditingProvider>
    </CentralStackProvider>
);

const expand = () => fireEvent.click(screen.getByTestId('expand-flow-node'));

/**
 * The panel's description box. Asked for inside the panel rather than on the page: the large editor
 * shows one of those beside the panel's.
 */
const panelSource = () => within(screen.getByTestId('flow-node-panel')).getByTestId('panel-source');

/** What the panel's template select is showing — the one the card is written from. */
const picked = () => within(screen.getByTestId('flow-node-panel')).getByTestId('flow-node-template');

/** Opens the panel's model select and takes the option named. */
const choose = (label: string, option: string) => {
    fireEvent.mouseDown(document.querySelector(`.ant-select[aria-label="${label}"] .ant-select-content`)!);
    fireEvent.click(document.querySelector(`.ant-select-item-option[title="${option}"]`)!);
};

/**
 * Handing the open flow node to an agent, which is all it takes: the card is typed AI. From the
 * large editor, which is where the type selector lives now — the panel asks nothing about the kind.
 */
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
    templateFolder.answers = false;
    showing(flowNode('Write the plan', 'lead'));
});

describe('FlowNodePanel — which flow node it is showing', () => {
    it('shows the title and the body as the two fields they are', () => {
        render(<Faces />);
        expect(screen.getByTestId('flow-node-title')).toHaveValue('Write the plan');
        expect(panelSource()).toHaveValue('lead');
    });

    /**
     * The focus a card made on the board canvas asked for. The menu picked a kind rather than
     * a title, so what is checked here are the two decisions the panel makes: that the wish names
     * the flow node it is showing, and that the title box takes the focus without a click first.
     */
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

    /**
     * The description belongs to a **task** — an AI card or a Human card, which is work somebody
     * does. A Shutdown and a Scheduler describe no work and the store keeps no description for
     * them, so offering a box nothing would be written to would be offering to lose what is typed.
     */
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

    // A flow node created while another was open takes the place the open one had, so what was typed
    // into the old one must not stay on screen — the next keystroke would write it over the flow node
    // that has just been made.
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

    // The other half of the same rule: a write comes back through the board, and reloading on it
    // would replace the document under the caret.
    it('stays put when the board hands back what the panel just wrote', () => {
        const { rerender } = render(<Faces />);

        fireEvent.change(panelSource(), { target: { value: 'lead\n\nmore' } });
        showing(flowNode('Write the plan', 'lead\n\nmore'));
        rerender(<Faces />);

        expect(panelSource()).toHaveValue('lead\n\nmore');
        expect(board.editFlowNode).toHaveBeenCalledTimes(1);
    });

    // And the third case, which is neither: the run marks the flow node the caret is in. The
    // description stays where it is — and the flow node is not re-opened for it.
    it('takes a mark made on the flow node it is open on', () => {
        const { rerender } = render(<Faces />);

        // What a play leaves: the description it sent is still there, and the card says done.
        showing({ ...flowNode('Write the plan', 'lead'), status: 'done', chat: 'chat-1' });
        rerender(<Faces />);

        expect(panelSource()).toHaveValue('lead');
    });

    // The same for a title a turn rewrote.
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

    // A body is a string of its own now, so a heading in one is a heading — nothing has to be
    // pushed down for the document to still hold one flow node where it held one.
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

    // Writing the folder is not handing the flow node to anyone: the body is left alone.
    it('writes the other three settings without touching the body', () => {
        showing(flowNode('Write the plan', 'lead', { model: 'opus' }));
        render(<Faces />);

        fireEvent.change(screen.getByLabelText('Working directory'), { target: { value: 'exchange' } });

        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, { settings: { model: 'opus', folder: '/exchange' } });
        expect(panelSource()).toHaveValue('lead');
    });

    // A path is written on a card far more often than it is read back against the store, and a
    // folder nobody can place is a card nobody can check. The crosshair at the end of the box is
    // the same one a link in a document carries.
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

/**
 * A screenshot is half of what a flow node about a screen is, and it is pasted into whichever box is in
 * front of the user. The panel is the one that used to swallow it.
 */
describe('FlowNodePanel — the image pasted into a flow node', () => {
    it('takes the paste on the body editor', () => {
        render(<Faces />);
        fireEvent.paste(panelSource());
        expect(paste.onPasteCapture).toHaveBeenCalled();
    });

    // A pasted image goes into the folder that belongs to the board — named after its handle, so
    // a rename does not orphan the links — and its link is written from the store root: a card is
    // held in a database row, not a document, so there is no folder for a relative link to resolve
    // against.
    it('offers the board’s own folder as where the image belongs, and links it from the store root', () => {
        render(<Faces />);
        expect(paste.folder).toBe('boards/major');
        expect(paste.documentName).toBe('major');
        expect(paste.linkFromRoot).toBe(true);
    });

    // The large editor is the same card's other face, so it hands the markdown editor's own paste
    // the same folder and the same link style — rather than the browsed file's folder, which is
    // wherever the reader last was.
    it('offers the large editor the same folder, and the same link from the store root', () => {
        render(<Faces />);
        expand();

        expect(largePaste.folder).toBe('boards/major');
        expect(largePaste.documentName).toBe('major');
        expect(largePaste.linkFromRoot).toBe(true);
    });

    // At the caret, through the editor's own document: the paste is one undo step, and the caret
    // stays after the image rather than jumping to the end of the flow node.
    it('writes the link where the caret is, through the editor itself', () => {
        showing(flowNode('Write the plan', 'Look at this.'));
        render(<Faces />);

        act(() => paste.insert('![shot.png](/boards/major/shot.png)'));

        expect(paste.insertBlockAt).toHaveBeenCalledWith(expect.anything(), '![shot.png](/boards/major/shot.png)');
    });

    // The fallback, and what it is for: a paste that reached the panel before the box under it had
    // an editor. The file is already in the store by then, so the link has to land somewhere.
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

/**
 * **The template a card is written from**: one of the store's `.temp.md` flow node templates, picked in
 * a select beside the description and instantiated on purpose.
 *
 * Typing the card picks the one that goes with it — `AI` or `Human` — which is the whole of what
 * typing it does to the text. Nothing is written into a body behind the user's back: a description
 * is text somebody typed, and the standing instructions an agent is given are a template they can
 * read before it is instantiated.
 */
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

    // The card is Human, so the select opens on `Human`; typing it AI picks the other one.
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

    // A template picked by hand is the answer about this card; another card is another answer.
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

    // An instantiation is an edit of the flow node like any other: it goes through the panel's own call,
    // onto the board and onto both faces, and there is nothing to apply afterwards.
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

    // The two faces are one editor, so they are one pick: the large editor opens on what the panel
    // was showing, and instantiating in either writes the same flow node.
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
        // And back in the editor it was pushed over, the instantiation gone from the stack.
        expect(screen.queryByTestId('central-panel-template-instantiation')).toBeNull();
        expect(screen.getByTestId('flow-node-editor')).toBeInTheDocument();
    });

    // Instantiating from the large editor pushes over it, and cancelling is back in it — the
    // description untouched, the editor exactly where it was.
    it('pushes over the large editor, and cancelling is back in it', async () => {
        render(<Faces />);
        await waitFor(() => expect(picked()).toHaveTextContent('Human'));
        expand();

        fireEvent.click(within(screen.getByTestId('flow-node-editor')).getByTestId('instantiate-template'));
        expect(screen.getByTestId('central-panel-template-instantiation')).toBeInTheDocument();
        // The editor under the instantiation paints nothing over it — its dropdowns included.
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
        // The markdown editor it opens is the usual one, preview toggles and all.
        expect(screen.getByTestId('editor-toolbar')).toBeInTheDocument();
    });

    // The first row is where the title is read and where it is written — one box, not a heading
    // over a field holding the same words a row below.
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

    // Everything the panel says about the open flow node is said here too, laid across the rows: where
    // the flow node runs, what plays it, where it stands and what it hands on to.
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

    // The panel is the one place the open flow node is held: the editor writes into it, not beside it.
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
        // One in the panel, one in the editor, both editing the same field.
        expect(agent).toHaveLength(2);

        fireEvent.mouseDown(agent[1].querySelector('.ant-select-content')!);
        fireEvent.click(document.querySelector('.ant-select-item-option[title="Runner"]')!);

        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            settings: { agent: 'agent-2' },
        });
    });

    // The editor is a panel on the stack: pushed over the board, closing back onto it. The
    // panel it was opened from stays on screen behind it, showing the same flow node.
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

    // The panel is a tool-bar tab, and hiding the right column unmounts it. This editor is not in
    // that column — it fills the middle of the screen — and has no business closing with it, least
    // of all in the middle of a sentence.
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

    // The other half of the same rule: the column coming back finds the flow node as it now stands,
    // rather than the text the panel was unmounted holding.
    it('hands the panel what was typed while its column was away', () => {
        const { rerender } = render(<Faces />);
        expand();
        rerender(<Faces panel={false} />);

        fireEvent.change(screen.getByTestId('editor-source'), { target: { value: 'typed alone' } });
        rerender(<Faces />);

        expect(panelSource()).toHaveValue('typed alone');
    });

    // Same rule as the panel's own settings: nothing to configure where nothing runs the flow node.
    it('offers no settings in the editor where Claude is off', () => {
        config.chatEnabled = false;
        render(<Faces />);
        expand();

        expect(screen.getByTestId('flow-node-editor')).toBeInTheDocument();
        expect(screen.queryByTestId('flow-node-meta')).toBeNull();
    });
});

// ── What the flow node hands on to ────────────────────────────────────────────────
//
// A chain names another card of the board, and the transition mode says what happens
// once the flow node is done: the chat handed on, shortened, ended, or the machine turned off. It is
// edited beside the settings, and in both faces of the editor.

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
    // is what this flow node does when it is done, which a card names with nothing after it at all.
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
    // its chat and hand it on, shorten it and end it, or neither.
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

    // What becomes of the conversation is a whole answer with nothing named after it: a card at the
    // end of a board still says whether its chat is carried on, and the select is offered on a flow node
    // that chains nowhere.
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

    // The box says what this flow node leaves its own conversation as, which is a statement a card at
    // the end of a board makes as plainly as one in the middle of a chain.
    it('asks about the compaction while nothing comes next', () => {
        showing(flowNode('Write the plan', 'lead', { model: 'opus' }));
        render(<Faces />);
        fireEvent.click(screen.getAllByTestId('flow-node-compact')[0]);
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            onSuccess: { flowNode: '', flowNodes: [], mode: 'end', compact: true },
        });
    });

    // A chain is the order somebody wrote the board in, and an order is worth writing down whoever
    // plays the cards: the flow node that comes next is asked of every card.
    it('names the flow node that comes next whoever plays the card', () => {
        showing(flowNode('Write the plan', 'lead'), other('flow-node-2', 'Ship it'));
        render(<Faces />);

        expect(document.querySelector('.ant-select[aria-label="On success"].ant-select-disabled')).toBeNull();
        choose('On success', 'Ship it');
        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, {
            onSuccess: { flowNode: 'flow-node-2', flowNodes: [], mode: 'end', compact: false },
        });
    });

    // The mode is where the chain and the type part company. It speaks about a conversation to
    // hand on, and a card somebody does by hand has none: it is not asked at all rather than asked
    // and marked.
    it('does not ask the mode of a Human flow node, and asks it the chain all the same', () => {
        showing(flowNode('Write the plan', 'lead'), other('flow-node-2', 'Ship it'));
        render(<Faces />);
        expect(document.querySelector('.ant-select[aria-label="Transition mode"]')).toBeNull();
        expect(document.querySelector('.ant-select[aria-label="On success"]')).not.toBeNull();
    });

    // Within an AI flow node it stays offered whatever else is missing — a mode picked before the effort
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

    // The box beside the mode claims a conversation to shorten, which is the same claim in the
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
        // The test id sits on the box's input; the mark sits on the label around it.
        expect(screen.getAllByTestId('flow-node-compact')[0].closest('label')!.className)
            .toContain(styles.metaCheckBroken);
    });

    // What becomes of the chat is something only a played card can mean, so a card typed back to
    // Human gives it up with the settings: left behind, it would sit in the document with nothing
    // on screen to reach it by.
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

    // Nothing is ever played once the machine is off, so a Shutdown is asked none of them: the
    // chain it held goes with what it said about the chat, and the line is not drawn at all.
    it('takes the chain off a card typed Shutdown, and stops asking about what follows it', () => {
        showing({
            ...flowNode('Write the plan', 'lead', { model: 'opus', effort: 'high' }),
            onSuccess: { flowNode: 'flow-node-2', flowNodes: [], mode: 'continue', compact: true },
        }, other('flow-node-2', 'Ship it'));
        const { rerender } = render(<Faces />);

        // From the large editor: the panel offers no type selector.
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
        // One in the panel, one on the last row of the large editor, both writing the same field.
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

    // A tag says what the flow node is about, not what plays it — so it is asked of a card nobody plays,
    // and it stays where Claude is not part of the build at all.
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

// ── Where the flow node stands, and the chat it was played in ─────────────────────

describe('FlowNodePanel — the state a play writes onto the flow node', () => {
    it('shows where the flow node stands, and sets it back', () => {
        showing({ ...flowNode('Write the plan', 'lead'), status: 'error' });
        render(<Faces />);

        expect(document.querySelector('.ant-select[aria-label="Status"]')).not.toBeNull();
        choose('Status', 'Ready');
        expect(board.setFlowNodeStatus).toHaveBeenCalledWith(FLOW_NODE_ID, 'ready');
    });

    // The select is the one place the eight are named together, so it is where the board's colours
    // are learnt: each option in the colour its card is striped with.
    it('names each status in the colour its card is striped with', () => {
        showing({ ...flowNode('Write the plan', 'lead'), status: 'error' });
        render(<Faces />);

        fireEvent.mouseDown(document.querySelector('.ant-select[aria-label="Status"] .ant-select-content')!);
        const tones = Array.from(document.querySelectorAll<HTMLElement>(
            `.ant-select-item-option .${styles.statusTone}`,
        ));
        expect(tones.map(tone => [tone.dataset.status, tone.textContent])).toEqual([
            ['draft', 'Draft'], ['ready', 'Ready'], ['blocked', 'Blocked'],
            ['running', 'In progress'], ['waiting-refresh', 'Waiting refresh'],
            ['interrupted', 'Interrupted'], ['done', 'Done'], ['error', 'Error'],
        ]);
    });

    // The status is not a Claude thing: a board kept by hand still says what is done.
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

    // A card somebody does by hand has no conversation to link to, so the line is not there to be
    // read: the chat is asked of an AI flow node and of no other.
    it('says nothing about a chat on a Human flow node', () => {
        render(<Faces />);
        expect(screen.getByTestId('flow-node-state')).not.toHaveTextContent('No chat yet');
        expect(screen.queryByTestId('open-flow-node-chat')).toBeNull();
    });

    // The link is what the user follows to read what a played flow node actually did.
    it('opens the flow node’s chat in the panel it is watched in', () => {
        showing({ ...flowNode('Write the plan', 'lead', { model: 'opus' }), chat: 'chat-1' });
        render(<Faces />);

        fireEvent.click(screen.getByTestId('open-flow-node-chat'));

        // Which panel that is, and bringing it up, is the publisher's — the board asks for the
        // conversation and nothing more.
        expect(show.showConversation).toHaveBeenCalledWith('chat-1');
    });

    // Forgetting the conversation is not deleting it: the flow node is played in a new one next time.
    it('takes the link off the flow node without touching the chat', () => {
        showing({ ...flowNode('Write the plan', 'lead', { model: 'opus' }), chat: 'chat-1' });
        render(<Faces />);

        fireEvent.click(screen.getByTestId('unlink-flow-node-chat'));

        expect(board.editFlowNode).toHaveBeenCalledWith(FLOW_NODE_ID, { chat: '' });
    });

    // A build with no Claude has no chats to mention.
    it('says nothing about a chat where Claude is off', () => {
        config.chatEnabled = false;
        showing({ ...flowNode('Write the plan', 'lead', { model: 'opus' }), chat: 'chat-1' });
        render(<Faces />);
        expect(screen.queryByTestId('open-flow-node-chat')).toBeNull();
    });
});



