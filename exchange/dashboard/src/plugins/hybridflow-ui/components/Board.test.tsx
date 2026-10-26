import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, act } from 'src/test/render';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { boardOf } from '../test/fixtures';
import { FakeHybridflowClient, HybridflowClientProvider, type ListedClassDto } from '../service';
import styles from '../Hybridflow.module.css';

/**
 * A card takes two gestures, and each asks for one surface: a click for the flow node panel in its tool
 * bar, a double-click for the large editor over the central area and not the panel. They begin
 * with the same click, so what the board does with it is the subject here.
 */

const FLOW_NODE_ID = 'flow-node-1';

const board = await vi.hoisted(async () => {
    const { createBoardMock } = await import('../test/mocks');
    return createBoardMock();
});

const toolBars = vi.hoisted(() => ({ showTab: vi.fn() }));

/** Whether this assembly plays flow nodes at all. Off for every test but the Play's own. */
const config = vi.hoisted(() => ({ chatEnabled: false }));

vi.mock('../Hybridflow-ctx', () => ({ useHybridflow: () => board }));

// The tag chips are a capability the `tags` plugin publishes; the board asks for it by name and
// wears nothing where nothing published it. Stubbed here, because a list read out of
// `kiao-user-config` is not this test's subject.
vi.mock('@cms-kit/capabilities', async importOriginal => ({
    ...(await importOriginal<typeof import('@cms-kit/capabilities')>()),
    useChatRunAvailable: () => true,
    useTagsAvailable: () => true,
    useTagsUi: (await import('src/test/mocks')).tagUiMock,
}));

vi.mock('@cms-core', async importOriginal => ({
    ...(await importOriginal<typeof import('@cms-core')>()),
    useToolBars: () => toolBars,
    useDashboardConfig: () => config,
}));

// The clipboard, the run and the delete dialog each have their own tests, and each would want a
// provider this one has no use for. What is watched here is which cards the menu names it — the
// board's rule about marks — and not what it then writes.
const clipboard = vi.hoisted(() => ({
    copyFlowNodes: vi.fn(), cutFlowNodes: vi.fn(), pasteFlowNodes: vi.fn(),
}));
vi.mock('../useBoardClipboard', () => ({ useBoardClipboard: () => clipboard }));
const deleteFlowNodes = vi.hoisted(() => vi.fn());
vi.mock('../useFlowNodeDelete', () => ({ useFlowNodeDelete: () => deleteFlowNodes }));
const archiveFlowNodes = vi.hoisted(() => vi.fn());
vi.mock('../useFlowNodeArchive', () => ({ useFlowNodeArchive: () => archiveFlowNodes }));
const instantiateClass = vi.hoisted(() => vi.fn());
vi.mock('../useInstantiateClass', () => ({
    useInstantiateClass: () => instantiateClass,
    useInstantiateWorkflowClass: () => vi.fn(),
}));

/** What the board asks of the service's runs. The play is watched by the naming test. */
const runs = vi.hoisted(() => ({ play: vi.fn(), stop: vi.fn() }));
vi.mock('../usePlayFlowNode', async importOriginal => ({
    ...(await importOriginal<typeof import('../usePlayFlowNode')>()),
    usePlayFlowNode: () => ({ runOn: () => null, documentAt: null, ...runs }),
}));

const { Board } = await import('./Board');
const { BoardControlsProvider } = await import('../BoardControls-ctx');
const { BoardFilterStrip } = await import('./BoardFilter');
const { newFlowNode } = await import('../boardContent');
const { FLOW_NODE_TAB_ID, WORKFLOW_TAB_ID } = await import('../constants');
const { CARD_WIDTH, SYMBOL_WIDTH } = await import('../boardSpots');

/** The board with its strip controls, as the boards page renders it. */
const BoardWithStrip: React.FC<{ handle: string }> = ({ handle }) => (
    <BoardControlsProvider>
        <BoardFilterStrip />
        <Board handle={handle} />
    </BoardControlsProvider>
);

const show = () => {
    const flowNode = { ...newFlowNode('Mine'), id: FLOW_NODE_ID };
    board.content = boardOf([flowNode]);
    return render(<BoardWithStrip handle="board" />);
};

/** Past the wait a click holds its panel back for, and then some. */
const settle = () => act(() => { vi.advanceTimersByTime(2000); });

describe('the instantiate menu catalogue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        board.marked = [];
        board.selected = null;
    });
    afterEach(cleanup);

    const target = (instantiable: boolean, title = 'Review'): ListedClassDto => ({
        id: 'review', title, type: 'human', instantiable, versions: [],
        boardSlug: 'library', boardName: 'Library',
        createdAt: '', updatedAt: '', revision: 1,
    });

    const showCatalogue = async (surface: 'empty' | 'canvas' | 'workflow') => {
        const node = { ...newFlowNode('Task'), id: 'task', spot: { x: 0, y: 0 }, workflow: 'w1' };
        board.content = boardOf(surface === 'empty' ? [] : [node]);
        if (surface === 'workflow') board.content.workflows = [{ id: 'w1', name: 'Sprint' }];
        const client = new FakeHybridflowClient(board.content);
        client.classesList = [target(false)];
        render(
            <HybridflowClientProvider client={client.asClient()}>
                <BoardWithStrip handle="board" />
            </HybridflowClientProvider>,
        );
        await act(async () => {});
        const menuSurface = surface === 'workflow'
            ? screen.getByText('Sprint')
            : screen.getByTestId('content-canvas');
        return { client, menuSurface };
    };

    it.each(['empty', 'canvas', 'workflow'] as const)(
        'offers a newly instantiable class when the %s menu opens without remounting',
        async surface => {
            const { client, menuSurface } = await showCatalogue(surface);
            client.classesList = [target(true, 'Updated review')];

            fireEvent.contextMenu(menuSurface);
            fireEvent.mouseEnter(await screen.findByText('Instantiate class...'));

            const entry = await screen.findByTestId(surface === 'workflow'
                ? 'instantiate-in-workflow-review' : 'instantiate-review');
            expect(entry).toHaveTextContent('Updated review (Library)');
        },
    );

    it('refreshes workflow classes alongside node classes', async () => {
        const { client, menuSurface } = await showCatalogue('canvas');
        client.workflowClassesList = [{
            id: 'release', name: 'Release', boardSlug: 'library', boardName: 'Library',
            createdAt: '', updatedAt: '', revision: 1,
        }];

        fireEvent.contextMenu(menuSurface);
        fireEvent.mouseEnter(await screen.findByText('Instantiate class...'));

        expect(await screen.findByTestId('instantiate-workflow-release'))
            .toHaveTextContent('Release (Library)');
    });

    it.each(['empty', 'canvas', 'workflow'] as const)(
        'lists classes alphabetically in the %s submenu',
        async surface => {
            const { client, menuSurface } = await showCatalogue(surface);
            client.classesList = ['Zebra', 'beta', '', 'Alpha'].map((title, index) => ({
                ...target(true, title), id: `class-${index}`,
            }));
            client.workflowClassesList = ['Delta', 'aardvark'].map((name, index) => ({
                id: `workflow-${index}`, name, boardSlug: 'library', boardName: 'Library',
                createdAt: '', updatedAt: '', revision: 1,
            }));

            fireEvent.contextMenu(menuSurface);
            fireEvent.mouseEnter(await screen.findByText('Instantiate class...'));
            await screen.findByTestId(surface === 'workflow'
                ? 'instantiate-in-workflow-class-0' : 'instantiate-class-0');

            const entries = screen.getAllByTestId(/^instantiate-/);
            expect(entries.map(entry => entry.textContent)).toEqual(
                (surface === 'workflow'
                    ? ['Alpha', 'beta', 'Untitled', 'Zebra']
                    : ['aardvark', 'Alpha', 'beta', 'Delta', 'Untitled', 'Zebra'])
                    .map(name => `${name} (Library)`),
            );
        },
    );

    it('keeps the latest menu refresh when an earlier listing finishes afterwards', async () => {
        const { client, menuSurface } = await showCatalogue('canvas');
        let answerEarlier!: (list: ListedClassDto[]) => void;
        vi.spyOn(client, 'flowNodeClasses')
            .mockImplementationOnce(() => new Promise(resolve => { answerEarlier = resolve; }))
            .mockResolvedValueOnce([target(true, 'Latest review')]);

        fireEvent.contextMenu(menuSurface);
        fireEvent.contextMenu(menuSurface);
        fireEvent.mouseEnter(await screen.findByText('Instantiate class...'));
        const entry = await screen.findByTestId('instantiate-review');
        expect(entry).toHaveTextContent('Latest review');

        await act(async () => { answerEarlier([target(false)]); });

        expect(screen.getByTestId('instantiate-review')).toHaveTextContent('Latest review');
    });
});

describe('instantiating from a class card', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        board.marked = [];
        board.selected = null;
    });
    afterEach(cleanup);

    it('instantiates the class right-clicked below its position, regardless of marks or catalogue visibility', async () => {
        const { newFlowNodeClass } = await import('../flowNodeClass');
        const one = { ...newFlowNodeClass('human', { x: 100, y: 80 }), id: 'one', title: 'One' };
        const two = { ...newFlowNodeClass('human', { x: 500, y: 80 }), id: 'two', title: 'Two' };
        board.content = { ...boardOf([]), flowNodeClasses: [one, two] };
        board.marked = ['one', 'two'];
        const client = new FakeHybridflowClient(board.content);
        render(
            <HybridflowClientProvider client={client.asClient()}>
                <BoardWithStrip handle="board" />
            </HybridflowClientProvider>,
        );
        await act(async () => {});
        const listing = vi.spyOn(client, 'flowNodeClasses');

        fireEvent.contextMenu(screen.getAllByTestId('flow-node-class-card')[1]);
        fireEvent.click(await screen.findByText('Instantiate...'));

        expect(instantiateClass).toHaveBeenCalledExactlyOnceWith('two', { x: 500, y: 244 });
        expect(listing).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Instantiate class...')).not.toBeInTheDocument();
    });
});

describe('the two gestures on a card', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => vi.useRealTimers());

    it('opens the flow node in its panel on a click', () => {
        show();
        fireEvent.click(screen.getByTestId('flow-node-card'));

        expect(board.select).toHaveBeenCalledWith(FLOW_NODE_ID);
        settle();
        expect(toolBars.showTab).toHaveBeenCalledWith(FLOW_NODE_TAB_ID);
        expect(board.setExpanded).not.toHaveBeenCalled();
    });

    it('opens the large editor on a double-click, and not the panel with it', () => {
        show();
        const card = screen.getByTestId('flow-node-card');
        // The events a double-click really is: the browser reports the pair only after the second
        // click, so the board has both ordinary clicks before it hears of the gesture.
        fireEvent.click(card);
        fireEvent.click(card);
        fireEvent.doubleClick(card);

        expect(board.setExpanded).toHaveBeenCalledWith(true);
        settle();
        expect(toolBars.showTab).not.toHaveBeenCalled();
    });

    it('leaves nothing behind to open the panel once the board is gone', () => {
        const view = show();
        fireEvent.click(screen.getByTestId('flow-node-card'));
        view.unmount();

        settle();
        expect(toolBars.showTab).not.toHaveBeenCalled();
    });
});


/**
 * What a card offers a Play for. Three things have to be true of a flow node before a press on it starts
 * anything, and the third is the one this file is here for: **there has to be something to send.**
 * The prompt is the flow node's title, description or success criteria, so a card with none of the
 * three carries no Play until one of them is written.
 */
describe('the Play a card offers', () => {
    const PLAYABLE = {
        agent: 'claude', model: 'opus', effort: 'high', permission: 'manualLive', folder: '/',
    };

    /** One card, as the board would show it. An AI one unless the case says otherwise. */
    const showing = (over: Partial<ReturnType<typeof newFlowNode>>) => {
        const flowNode = {
            ...newFlowNode('Mine', 'Do the thing.', PLAYABLE), id: FLOW_NODE_ID, ...over,
        };
        board.content = boardOf([flowNode]);
        return render(<BoardWithStrip handle="board" />);
    };

    beforeEach(() => {
        vi.clearAllMocks();
        config.chatEnabled = true;
    });
    afterEach(() => { config.chatEnabled = false; });

    it('offers one for a ready flow node with a description and the five settings', () => {
        showing({});
        expect(screen.getByTestId('play-flow-node')).toBeInTheDocument();
    });

    // A card with an empty box is still asked on its name: the title stands in for the missing
    // description, so a titled card with nothing written in it carries a Play.
    it('offers one for a flow node with no description but a title', () => {
        showing({ body: '' });
        expect(screen.getByTestId('play-flow-node')).toBeInTheDocument();
    });

    it('offers one for a description of nothing but blank lines where the title stands', () => {
        showing({ body: '  \n\n  ' });
        expect(screen.getByTestId('play-flow-node')).toBeInTheDocument();
    });

    // A task is valid with a title, a description or a success criterion: with none of the three
    // it has nothing to send, and the Play is off until one of them is written.
    it('offers none for a flow node with none of the three', () => {
        showing({ title: '', body: '' });
        expect(screen.queryByTestId('play-flow-node')).toBeNull();
    });

    it('offers one for a flow node with only a success criterion', () => {
        showing({ title: '', body: '', criteria: [{ id: 'c1', text: 'It holds' }] });
        expect(screen.getByTestId('play-flow-node')).toBeInTheDocument();
    });

    it('offers none where the settings name no model', () => {
        showing({ type: 'human', settings: {} });
        expect(screen.queryByTestId('play-flow-node')).toBeNull();
    });

    // Schedulers can start a chain directly; Shutdowns and Gateways are reached by chains.
    it('offers Play for a configured Scheduler, and none for an incomplete one, Shutdown or Gateway', () => {
        showing({ type: 'shutdown', body: '', settings: {} });
        expect(screen.queryByTestId('play-flow-node')).toBeNull();

        cleanup();
        showing({ type: 'scheduler', body: '', settings: {}, at: '2026-09-03T22:00' });
        expect(screen.getByTestId('play-flow-node')).toBeInTheDocument();

        cleanup();
        showing({ type: 'scheduler', body: '', settings: {}, at: '' });
        expect(screen.queryByTestId('play-flow-node')).toBeNull();

        cleanup();
        showing({ type: 'gateway', body: '', settings: {} });
        expect(screen.queryByTestId('play-flow-node')).toBeNull();
    });

    // Several runs play at once, and the name is the whole of what tells them apart afterwards — in
    // the panel, in the notices, on the card. So Play asks for one instead of starting anything.
    it('asks what the chain run is to be called before it starts one', async () => {
        showing({});
        fireEvent.click(screen.getByTestId('play-flow-node'));
        expect(runs.play).not.toHaveBeenCalled();

        const box = await screen.findByTestId('chain-run-name');
        // Prefilled with the moment it starts, which is a name — and a name typed over costs a
        // keystroke, where an empty box would cost a sentence every time.
        expect((box as HTMLInputElement).value).toMatch(/^Started /);

        fireEvent.change(box, { target: { value: 'Nightly' } });
        fireEvent.click(screen.getByText('Start'));
        expect(runs.play).toHaveBeenCalledWith(FLOW_NODE_ID, 'Nightly');
    });

    it('starts nothing when the naming is cancelled', async () => {
        showing({});
        fireEvent.click(screen.getByTestId('play-flow-node'));
        await screen.findByTestId('chain-run-name');

        fireEvent.click(screen.getByText('Cancel'));
        expect(runs.play).not.toHaveBeenCalled();
    });
});

/**
 * The filter in the document tab strip: the words its cards wear, each a chip that can be pressed.
 * The filter is the view's — nothing here writes the document — so what is watched is which cards
 * are drawn.
 */
describe('the filter in the tab strip', () => {
    /** The titles of the cards on the board, by id — a card's own text carries its chips too. */
    const titles = new Map<string, string>();
    const card = (title: string, ...tags: string[]) => {
        const made = { ...newFlowNode(title), tags };
        titles.set(made.id, title);
        return made;
    };

    const tagged = () => {
        board.content = boardOf([
            card('Bugged', 'bug'), card('Bare'), card('Drawn', 'ui'), card('Both', 'bug', 'ui'),
        ]);
        return render(<BoardWithStrip handle="board" />);
    };

    const shownCards = () => screen.getAllByTestId('flow-node-card')
        .map(one => titles.get(one.getAttribute('data-flow-node-id') ?? ''));
    const chip = (label: string) => screen.getByRole('button', { name: `Show only ${label}` });

    beforeEach(() => vi.clearAllMocks());

    it('offers the words the board wears, and no filter until one is pressed', () => {
        tagged();
        expect(screen.getAllByTestId('board-filter-tag').map(one => one.dataset.tag)).toEqual(['bug', 'ui']);
        expect(screen.getAllByTestId('flow-node-card')).toHaveLength(4);
        expect(screen.queryByTestId('board-filter-count')).toBeNull();
    });

    // A board of untagged cards has nothing to be asked about it, so it wears no chips — and the
    // row draws nothing else.
    it('wears no chip where no card wears a word', () => {
        show();
        expect(screen.queryAllByTestId('board-filter-tag')).toHaveLength(0);
        expect(screen.queryByTestId('board-filter-count')).toBeNull();
    });

    it('leaves only the cards carrying the word pressed', () => {
        tagged();
        fireEvent.click(chip('bug'));

        expect(shownCards()).toEqual(['Bugged', 'Both']);
        expect(screen.getByTestId('board-filter-count').textContent).toBe('2 of 4 shown');
    });

    // Several words are read as "or": the wider question is the one a row of chips looks like.
    it('adds a second word to the question rather than narrowing it', () => {
        tagged();
        fireEvent.click(chip('bug'));
        fireEvent.click(chip('ui'));

        expect(shownCards()).toEqual(['Bugged', 'Drawn', 'Both']);
    });

    it('gives every card back when the word is pressed again', () => {
        tagged();
        fireEvent.click(chip('bug'));
        fireEvent.click(chip('bug'));

        expect(screen.getAllByTestId('flow-node-card')).toHaveLength(4);
    });

    it('gives every card back at one press on Clear', () => {
        tagged();
        fireEvent.click(chip('bug'));
        fireEvent.click(chip('ui'));
        fireEvent.click(screen.getByTestId('board-filter-clear'));

        expect(screen.getAllByTestId('flow-node-card')).toHaveLength(4);
        expect(screen.queryByTestId('board-filter-count')).toBeNull();
    });
});


/**
 * Several cards picked out with <kbd>Ctrl</kbd>-click, and what the gestures aimed at one of
 * them then do to all of them: a drag that carries the lot, and a Delete or an Archive that takes the lot.
 *
 * The rule under test is the one the whole feature rests on — *a gesture aimed at a marked card is
 * about every marked card, and aimed at an unmarked one is about that card alone* — so each case is
 * run both ways round.
 */
describe('cards marked with Ctrl-click', () => {
    /** Three cards on the board. */
    const showBoard = () => {
        const flowNodes = ['One', 'Two', 'Three'].map((title, rank) => ({ ...newFlowNode(title), id: `flow-node-${rank}` }));
        board.content = boardOf(flowNodes);
        return render(<BoardWithStrip handle="board" />);
    };

    /** The card by its title. */
    const card = (title: string) =>
        screen.getAllByTestId('flow-node-card').find(element => element.textContent?.includes(title))!;

    beforeEach(() => {
        vi.clearAllMocks();
        board.marked = [];
    });
    afterEach(() => { board.marked = []; });

    it('marks the card rather than opening it', () => {
        showBoard();
        fireEvent.click(card('One'), { ctrlKey: true });

        expect(board.toggleMark).toHaveBeenCalledWith('flow-node-0');
        // Picking out five cards must not be five flow nodes opened in the panel on the way.
        expect(board.select).not.toHaveBeenCalled();
        expect(toolBars.showTab).not.toHaveBeenCalled();
    });

    it('marks it on Cmd-click too, which is the same gesture on a Mac', () => {
        showBoard();
        fireEvent.click(card('Two'), { metaKey: true });

        expect(board.toggleMark).toHaveBeenCalledWith('flow-node-1');
        expect(board.select).not.toHaveBeenCalled();
    });

    it('takes every marked card off at one press of Delete', () => {
        board.marked = ['flow-node-0', 'flow-node-1'];
        showBoard();

        fireEvent.keyDown(card('One'), { key: 'Delete' });

        expect(deleteFlowNodes).toHaveBeenCalledWith(['flow-node-0', 'flow-node-1']);
    });

    it('takes the card the key came from where none is marked', () => {
        showBoard();

        fireEvent.keyDown(card('Two'), { key: 'Delete' });

        expect(deleteFlowNodes).toHaveBeenCalledWith(['flow-node-1']);
    });

    it('takes the card the key came from where it is not one of the marked', () => {
        board.marked = ['flow-node-0', 'flow-node-1'];
        showBoard();

        fireEvent.keyDown(card('Three'), { key: 'Delete' });

        expect(deleteFlowNodes).toHaveBeenCalledWith(['flow-node-2']);
    });

    // The way out of a selection made by mistake, without finding the cards again to click them off.
    it('gives the marks back on Escape', () => {
        board.marked = ['flow-node-0', 'flow-node-1'];
        showBoard();

        fireEvent.keyDown(card('One'), { key: 'Escape' });

        expect(board.clearMarks).toHaveBeenCalled();
    });

    // The copy goes under the card the menu was opened on, marks or no marks: the board files it
    // by that card's id, so nothing here depends on which cards are picked out.
    it('clones the card the menu was opened on', async () => {
        board.marked = ['flow-node-0', 'flow-node-1'];
        showBoard();

        fireEvent.contextMenu(card('Two'));
        await act(async () => { await Promise.resolve(); });
        fireEvent.click(screen.getByText('Clone node'));

        expect(board.cloneFlowNode).toHaveBeenCalledWith('flow-node-1');
    });

    it('says in the menu how many cards its Delete takes', async () => {
        board.marked = ['flow-node-0', 'flow-node-1'];
        showBoard();

        fireEvent.contextMenu(card('One'));
        await act(async () => { await Promise.resolve(); });

        expect(screen.getByText('Delete 2 nodes')).toBeTruthy();
    });

    it('says in the menu how many cards its Archive takes', async () => {
        board.marked = ['flow-node-0', 'flow-node-1'];
        showBoard();

        fireEvent.contextMenu(card('One'));
        await act(async () => { await Promise.resolve(); });

        expect(screen.getByText('Archive 2 nodes')).toBeTruthy();
    });

    it('archives every marked card from the menu', async () => {
        board.marked = ['flow-node-0', 'flow-node-1'];
        showBoard();

        fireEvent.contextMenu(card('One'));
        await act(async () => { await Promise.resolve(); });
        fireEvent.click(screen.getByText('Archive 2 nodes'));

        expect(archiveFlowNodes).toHaveBeenCalledWith(['flow-node-0', 'flow-node-1']);
    });

    it('archives the card the menu was opened on where it is not one of the marked', async () => {
        board.marked = ['flow-node-0', 'flow-node-1'];
        showBoard();

        fireEvent.contextMenu(card('Three'));
        await act(async () => { await Promise.resolve(); });
        fireEvent.click(screen.getByText('Archive node'));

        expect(archiveFlowNodes).toHaveBeenCalledWith(['flow-node-2']);
    });

    // The clipboard is written out of sight, so the count in the item is the only thing that says
    // what was taken before it is pasted in another store.
    it('copies every marked card, and says in the menu how many', async () => {
        board.marked = ['flow-node-0', 'flow-node-1'];
        showBoard();

        fireEvent.contextMenu(card('One'));
        await act(async () => { await Promise.resolve(); });
        fireEvent.click(screen.getByText('Copy 2 nodes'));

        expect(clipboard.copyFlowNodes).toHaveBeenCalledWith(['flow-node-0', 'flow-node-1']);
    });

    it('copies the card the menu was opened on where it is not one of the marked', async () => {
        board.marked = ['flow-node-0', 'flow-node-1'];
        showBoard();

        fireEvent.contextMenu(card('Three'));
        await act(async () => { await Promise.resolve(); });
        fireEvent.click(screen.getByText('Copy node'));

        expect(clipboard.copyFlowNodes).toHaveBeenCalledWith(['flow-node-2']);
    });

    // The cut takes the cards the copy takes — it *is* that copy, with the cards taken off after —
    // and asks nothing first, so the count in the item is the whole of what says which are leaving.
    it('cuts every marked card, and says in the menu how many', async () => {
        board.marked = ['flow-node-0', 'flow-node-1'];
        showBoard();

        fireEvent.contextMenu(card('One'));
        await act(async () => { await Promise.resolve(); });
        fireEvent.click(screen.getByText('Cut 2 nodes'));

        expect(clipboard.cutFlowNodes).toHaveBeenCalledWith(['flow-node-0', 'flow-node-1']);
    });
});

/**
 * Copy, cut and paste from the keyboard: Ctrl+C, Ctrl+X and Ctrl+V on the keys every program puts
 * them on. The rule about marks is the menu's — a press on a marked card is about every marked
 * card, and on an unmarked one is about that card alone — and the paste names no point, so its
 * cards arrive unplaced.
 */
describe('copying, cutting and pasting from the keyboard', () => {
    /** Three cards on the board. */
    const showBoard = () => {
        const flowNodes = ['One', 'Two', 'Three'].map((title, rank) => ({ ...newFlowNode(title), id: `flow-node-${rank}` }));
        board.content = boardOf(flowNodes);
        return render(<BoardWithStrip handle="board" />);
    };

    /** The card by its title. */
    const card = (title: string) =>
        screen.getAllByTestId('flow-node-card').find(element => element.textContent?.includes(title))!;

    beforeEach(() => {
        vi.clearAllMocks();
        board.marked = [];
    });
    afterEach(() => { board.marked = []; });

    it('copies every marked card on Ctrl+C', () => {
        board.marked = ['flow-node-0', 'flow-node-1'];
        showBoard();

        fireEvent.keyDown(card('One'), { key: 'c', ctrlKey: true });

        expect(clipboard.copyFlowNodes).toHaveBeenCalledWith(['flow-node-0', 'flow-node-1']);
    });

    it('copies the card the press came from where it is not one of the marked', () => {
        board.marked = ['flow-node-0', 'flow-node-1'];
        showBoard();

        fireEvent.keyDown(card('Three'), { key: 'c', ctrlKey: true });

        expect(clipboard.copyFlowNodes).toHaveBeenCalledWith(['flow-node-2']);
    });

    it('cuts every marked card on Ctrl+X', () => {
        board.marked = ['flow-node-0', 'flow-node-1'];
        showBoard();

        fireEvent.keyDown(card('Two'), { key: 'x', ctrlKey: true });

        expect(clipboard.cutFlowNodes).toHaveBeenCalledWith(['flow-node-0', 'flow-node-1']);
    });

    it('cuts the card the press came from where none is marked', () => {
        showBoard();

        fireEvent.keyDown(card('Two'), { key: 'x', ctrlKey: true });

        expect(clipboard.cutFlowNodes).toHaveBeenCalledWith(['flow-node-1']);
    });

    // Cmd beside Ctrl, which is the same gesture on a Mac.
    it('copies on Cmd+C too', () => {
        showBoard();

        fireEvent.keyDown(card('One'), { key: 'c', metaKey: true });

        expect(clipboard.copyFlowNodes).toHaveBeenCalledWith(['flow-node-0']);
    });

    // Words picked out of the card are the user's own copy: the press is let through to the
    // browser, which copies them as text, and the nodes stay out of it.
    it('lets a press with words selected through to the browser', () => {
        const selected = vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection);
        try {
            showBoard();

            fireEvent.keyDown(card('One'), { key: 'c', ctrlKey: true });

            expect(clipboard.copyFlowNodes).not.toHaveBeenCalled();
        } finally {
            selected.mockRestore();
        }
    });

    // A paste is aimed at no card: its cards arrive unplaced, whatever card the focus is on.
    it('pastes with no point on Ctrl+V', () => {
        showBoard();

        fireEvent.keyDown(card('One'), { key: 'v', ctrlKey: true });

        expect(clipboard.pasteFlowNodes).toHaveBeenCalledWith();
    });

    // After a cut the card is gone, and the focus went with it — and the paste that follows is
    // still the board's.
    it('pastes with the focus nowhere at all', () => {
        showBoard();

        fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true });

        expect(clipboard.pasteFlowNodes).toHaveBeenCalledWith();
    });

    // A box being typed in keeps its own paste: the clipboard's JSON has nothing to say to it.
    it('leaves a press in a box being typed in to the box', () => {
        showBoard();
        const box = document.createElement('input');
        document.body.appendChild(box);
        try {
            fireEvent.keyDown(box, { key: 'v', ctrlKey: true });

            expect(clipboard.pasteFlowNodes).not.toHaveBeenCalled();
        } finally {
            box.remove();
        }
    });

    // And a press aimed at another panel is that panel's.
    it('leaves a press aimed outside the board to whatever it was aimed at', () => {
        showBoard();
        const elsewhere = document.createElement('div');
        elsewhere.tabIndex = 0;
        document.body.appendChild(elsewhere);
        try {
            fireEvent.keyDown(elsewhere, { key: 'v', ctrlKey: true });

            expect(clipboard.pasteFlowNodes).not.toHaveBeenCalled();
        } finally {
            elsewhere.remove();
        }
    });
});

/**
 * The board: the cards where somebody put them, and an arrow from each card to the one it hands on
 * to.
 */
describe('the board', () => {
    /** Two chained cards and a loose one, none of them ever placed. */
    const showBoard = (over: Record<string, unknown> = {}) => {
        const one = {
            ...newFlowNode('One'), id: 'flow-node-0',
            onSuccess: { flowNode: 'flow-node-1', flowNodes: [], mode: 'continue' as const, compact: false },
        };
        const two = { ...newFlowNode('Two'), id: 'flow-node-1' };
        const three = { ...newFlowNode('Three'), id: 'flow-node-2' };
        board.content = boardOf([one, two, three]);
        Object.assign(board, over);
        return render(<BoardWithStrip handle="board" />);
    };

    beforeEach(() => {
        vi.clearAllMocks();
        board.marked = [];
        board.selected = null;
    });
    afterEach(cleanup);

    it('draws the canvas, with every card on it', () => {
        showBoard();
        expect(screen.getByTestId('content-canvas')).toBeInTheDocument();
        expect(screen.getAllByTestId('content-card')).toHaveLength(3);
    });

    /**
     * The canvas has no box to type a title into, so the gesture that makes a card here is the
     * one a file manager makes a file with: a right-click where the card is to go, and the kind
     * picked from the menu. The card opens in the panel, which is where it is named.
     */
    it('makes a card of the kind picked, where the canvas was right-clicked', async () => {
        showBoard();
        fireEvent.contextMenu(screen.getByTestId('content-canvas'), { clientX: 140, clientY: 90 });
        await act(async () => { await Promise.resolve(); });

        // The seven kinds, in the order the type select offers them.
        expect(screen.getAllByTestId('new-card').map(one => one.dataset.type))
            .toEqual(['ai', 'human', 'shutdown', 'scheduler', 'gateway', 'note', 'value']);

        fireEvent.click(screen.getAllByTestId('new-card').find(one => one.dataset.type === 'scheduler')!);

        // The point is the pointer's, less the margin every card is drawn inside.
        expect(board.addFlowNode).toHaveBeenCalledWith('scheduler', { x: 132, y: 82 });
        expect(toolBars.showTab).toHaveBeenCalledWith(FLOW_NODE_TAB_ID);
    });

    // The canvas's menu makes cards, and takes a paste: the same gesture, where it was
    // right-clicked, for the block the clipboard is holding.
    it('pastes the clipboard’s flow nodes where the canvas was right-clicked', async () => {
        showBoard();
        fireEvent.contextMenu(screen.getByTestId('content-canvas'), { clientX: 140, clientY: 90 });
        await act(async () => { await Promise.resolve(); });

        fireEvent.click(screen.getByTestId('paste-flow-node'));

        // The point is the pointer's, less the margin every card is drawn inside.
        expect(clipboard.pasteFlowNodes).toHaveBeenCalledWith({ x: 132, y: 82 });
    });

    // The one place the menu has to say it is there: no card to right-click, no quick box, and
    // nothing on screen that could be mistaken for either.
    it('offers the same menu on a canvas with no card on it at all', async () => {
        showBoard({ content: boardOf([]) });
        expect(screen.getByTestId('content-canvas').textContent)
            .toContain('right-click to make one');

        fireEvent.contextMenu(screen.getByTestId('content-canvas'));
        await act(async () => { await Promise.resolve(); });
        fireEvent.click(screen.getAllByTestId('new-card').find(one => one.dataset.type === 'ai')!);

        expect(board.addFlowNode).toHaveBeenCalledWith('ai', { x: 0, y: 0 });
    });

    // A board that has never been laid out says no place on any of its cards; the layout
    // follows the chains and is written down at once, so that from then on nothing
    // moves unless somebody moves it.
    it('places the cards that have never been placed, in one write', () => {
        showBoard();
        expect(board.placeFlowNodes).toHaveBeenCalledTimes(1);
        const spots = board.placeFlowNodes.mock.calls[0][0] as Map<string, { x: number; y: number }>;
        expect([...spots.keys()].sort()).toEqual(['flow-node-0', 'flow-node-1', 'flow-node-2']);
        // The chain reads left to right along one row, and the card nothing chains starts another.
        expect(spots.get('flow-node-0')?.y).toBe(spots.get('flow-node-1')?.y);
        expect(spots.get('flow-node-1')!.x).toBeGreaterThan(spots.get('flow-node-0')!.x);
        expect(spots.get('flow-node-2')!.y).toBeGreaterThan(spots.get('flow-node-0')!.y);
    });

    it('draws an arrow from a card to the one it hands on to, and nowhere else', () => {
        showBoard({
            content: boardOf([
                {
                    ...newFlowNode('One'), id: 'flow-node-0', spot: { x: 0, y: 0 },
                    onSuccess: { flowNode: 'flow-node-1', flowNodes: [], mode: 'continue' as const, compact: false },
                },
                { ...newFlowNode('Two'), id: 'flow-node-1', spot: { x: 400, y: 0 } },
            ]),
        });
        const drawn = screen.getAllByTestId('content-link');
        expect(drawn).toHaveLength(1);
        expect(drawn[0].dataset.from).toBe('flow-node-0');
        // Left to right between two cards side by side, and it stops short of the second.
        expect(Number(drawn[0].getAttribute('x1'))).toBeLessThan(Number(drawn[0].getAttribute('x2')));
    });

    // A symbol is narrower than a card — a shape with a label under it — and a chain into one
    // lands on the shape, over the label.
    it('draws a symbol narrower than a card, and chains into its shape', () => {
        showBoard({
            content: boardOf([
                {
                    ...newFlowNode('One'), id: 'flow-node-0', spot: { x: 0, y: 0 },
                    onSuccess: { flowNode: 'flow-node-1', flowNodes: [], mode: 'end' as const, compact: false },
                },
                {
                    ...newFlowNode('Two'), id: 'flow-node-1', type: 'scheduler', spot: { x: 400, y: 0 },
                },
            ]),
        });
        const placed = screen.getAllByTestId('content-card');
        expect(placed).toHaveLength(2);
        expect(placed[0].style.width).toBe(`${CARD_WIDTH}px`);
        expect(placed[1].style.width).toBe(`${SYMBOL_WIDTH}px`);

        const drawn = screen.getAllByTestId('content-link');
        expect(drawn).toHaveLength(1);
        expect(Number(drawn[0].getAttribute('x1'))).toBeLessThan(Number(drawn[0].getAttribute('x2')));
        // Into the shape row at the top of the symbol, not the label's middle under it.
        expect(Number(drawn[0].getAttribute('y2'))).toBeLessThan(50);
    });

    // A chain with one end on screen is a chain there is nothing to draw to.
    it('draws no arrow to a card the tag filter is holding back', () => {
        showBoard({
            content: boardOf([
                {
                    ...newFlowNode('One'), id: 'flow-node-0', tags: ['bug'], spot: { x: 0, y: 0 },
                    onSuccess: { flowNode: 'flow-node-1', flowNodes: [], mode: 'end' as const, compact: false },
                },
                { ...newFlowNode('Two'), id: 'flow-node-1', spot: { x: 400, y: 0 } },
            ]),
        });
        fireEvent.click(screen.getByTestId('board-filter-tag'));

        expect(screen.getAllByTestId('content-card')).toHaveLength(1);
        expect(screen.queryAllByTestId('content-link')).toHaveLength(0);
    });

    it('opens a flow node from a card on the canvas', () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        showBoard();
        fireEvent.click(screen.getAllByTestId('flow-node-card')[0]);
        expect(board.select).toHaveBeenCalledWith('flow-node-0');
        vi.useRealTimers();
    });

    it('clears the selection on a click outside any card', () => {
        showBoard({ selected: 'flow-node-0', marked: ['flow-node-0'] });
        fireEvent.click(screen.getByTestId('content-canvas'));
        expect(board.select).toHaveBeenCalledWith(null);
    });

    it('keeps the selection on a click on a card', () => {
        showBoard({ selected: 'flow-node-0' });
        fireEvent.click(screen.getAllByTestId('flow-node-card')[0]);
        expect(board.select).not.toHaveBeenCalledWith(null);
    });

    /**
     * The size the board is read at, asked in the tab strip: the sheet is drawn at its own size
     * and scaled to it, and the gestures that read the pointer divide by it, so a card is made
     * where the pointer is whatever the board is read at.
     */
    describe('the zoom', () => {
        beforeEach(() => {
            // antd's popups measure themselves, and jsdom has no ResizeObserver.
            vi.stubGlobal('ResizeObserver', class {
                observe() { /* nothing to measure */ }
                unobserve() { /* nothing to measure */ }
                disconnect() { /* nothing to measure */ }
            });
        });

        /** Picks a size in the strip's zoom box. */
        const pickZoom = (label: string) => {
            const box = screen.getByTestId('board-filter').querySelector('.ant-select')!;
            fireEvent.mouseDown(box.querySelector('.ant-select-selector, .ant-select-content')!);
            const found = [...document.querySelectorAll<HTMLElement>('.ant-select-item-option')]
                .find(item => item.textContent === label)!;
            fireEvent.click(found);
        };

        it('is offered in the strip, at the board’s own size', () => {
            showBoard();

            expect(screen.getByTestId('board-filter').querySelector('.ant-select')).not.toBeNull();
            expect(screen.getByText('100%')).toBeInTheDocument();
        });

        it('draws the sheet at the size the strip asks for', () => {
            showBoard();
            const full = Number.parseFloat(screen.getByTestId('content-sheet').style.width);

            pickZoom('50%');

            expect(screen.getByTestId('content-scaled').style.transform).toBe('scale(0.5)');
            expect(Number.parseFloat(screen.getByTestId('content-sheet').style.width)).toBe(full / 2);
        });

        it('makes the card where the pointer is at the size the board is read at', async () => {
            showBoard();
            pickZoom('50%');

            fireEvent.contextMenu(screen.getByTestId('content-canvas'), { clientX: 140, clientY: 90 });
            await act(async () => { await Promise.resolve(); });
            fireEvent.click(screen.getAllByTestId('new-card').find(one => one.dataset.type === 'ai')!);

            // The pointer's point in canvas pixels — through the zoom — less the margin every
            // card is drawn inside.
            expect(board.addFlowNode).toHaveBeenCalledWith('ai', { x: 272, y: 172 });
        });
    });

    // A card is coloured by its status: the stripe, and the line naming it under the title.
    it('colours a card by its status', () => {
        const statuses = [
            'draft', 'ready', 'blocked', 'running', 'waiting-refresh', 'interrupted', 'done',
            'error',
        ] as const;
        board.content = boardOf(
            statuses.map((status, slot) => ({ ...newFlowNode(`FlowNode ${status}`), id: `flow-node-${slot}`, status })),
        );
        render(<BoardWithStrip handle="board" />);

        const cards = screen.getAllByTestId('flow-node-card');
        expect(cards).toHaveLength(statuses.length);
        expect(cards.map(card => card.getAttribute('data-status'))).toEqual([...statuses]);
    });

    // The stripes read their colours off `--flow-node-*` custom properties, which reach a card only
    // through its ancestors — so the palette has to be declared on a scope covering the board.
    it('declares the status palette where the board can reach it', () => {
        // Found from wherever vitest was started: the package itself, or the repository root.
        const cssPath = [
            'src/plugins/hybridflow-ui/Hybridflow.module.css',
            'exchange/dashboard/src/plugins/hybridflow-ui/Hybridflow.module.css',
        ].map(one => resolve(process.cwd(), one)).find(one => existsSync(one));
        expect(cssPath, 'Hybridflow.module.css is found').toBeDefined();
        const css = readFileSync(cssPath as string, 'utf8');
        const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
        for (const variable of [
            '--flow-node-draft', '--flow-node-ready', '--flow-node-running', '--flow-node-waiting-refresh',
            '--flow-node-interrupted', '--flow-node-done', '--flow-node-error',
        ]) {
            const reached = rules.some(([, selectors, body]) =>
                body.includes(variable)
                && selectors.split(',').some(one => ['.boardArea', '.board'].includes(one.trim())));
            expect(reached, `${variable} reaches the board`).toBe(true);
        }
    });
});

/**
 * The box pulled on the empty canvas to pick cards out: what it covers is the marked set, live
 * as it moves — a fresh box holding exactly those cards, and one pulled with Ctrl held adding
 * them to the set it found. Cards and classes alike.
 *
 * Three unplaced cards are laid out one row per card, 164 pixels apart, each 221 wide and 108
 * high at the nominal height jsdom leaves them: the first spans y 8–116, the second 172–280.
 */
describe('box selection on the canvas', () => {
    /** Three cards on the board. */
    const showBoard = () => {
        const flowNodes = ['One', 'Two', 'Three'].map((title, rank) => ({ ...newFlowNode(title), id: `flow-node-${rank}` }));
        board.content = boardOf(flowNodes);
        return render(<BoardWithStrip handle="board" />);
    };

    const canvasEl = () => screen.getByTestId('content-canvas');

    /** The card by its title. */
    const card = (title: string) =>
        screen.getAllByTestId('flow-node-card').find(element => element.textContent?.includes(title))!;

    /**
     * jsdom has no `PointerEvent`, and Testing Library's fallback `Event` drops
     * `clientX`/`clientY` — the two things a box is made of. A `MouseEvent`
     * named after the pointer event carries them, and React dispatches on the
     * name. See `useSpotDrag.test.tsx`.
     */
    const pointer = (
        type: string, target: Element, clientX: number, clientY: number, ctrlKey = false,
    ) => {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0, ctrlKey });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        Object.defineProperty(event, 'pointerType', { value: 'mouse' });
        fireEvent(target, event);
    };

    /** Pulls a box from `(fromX, fromY)` to `(toX, toY)` and lets go there. */
    const pullTo = (fromX: number, fromY: number, toX: number, toY: number, ctrlKey = false) => {
        pointer('pointerdown', canvasEl(), fromX, fromY, ctrlKey);
        pointer('pointermove', canvasEl(), toX, toY, ctrlKey);
        pointer('pointerup', canvasEl(), toX, toY, ctrlKey);
    };

    beforeEach(() => {
        vi.clearAllMocks();
        board.marked = [];
        board.selected = null;
    });
    afterEach(() => { board.marked = []; board.selected = null; });

    it('picks out what the box covers, live, as it moves', () => {
        showBoard();
        const canvas = canvasEl();

        pointer('pointerdown', canvas, 0, 0);
        // Over the first card alone — drawn, and reported before anything is let go.
        pointer('pointermove', canvas, 300, 130);
        expect(screen.getByTestId('box-select-rect')).toBeInTheDocument();
        expect(board.setMarked).toHaveBeenLastCalledWith(['flow-node-0']);

        // Grown to take the second card too.
        pointer('pointermove', canvas, 300, 300);
        expect(board.setMarked).toHaveBeenLastCalledWith(['flow-node-0', 'flow-node-1']);

        pointer('pointerup', canvas, 300, 300);
        expect(screen.queryByTestId('box-select-rect')).toBeNull();
        expect(board.setMarked).toHaveBeenLastCalledWith(['flow-node-0', 'flow-node-1']);
    });

    // A fresh box is a fresh selection: the opening goes the way a click on the empty canvas
    // takes it, and the marked set holds exactly what the box covers.
    it('clears the selection when the box starts without Ctrl', () => {
        board.selected = 'flow-node-2';
        board.marked = ['flow-node-2'];
        showBoard();

        pullTo(0, 0, 300, 130);

        expect(board.select).toHaveBeenCalledWith(null);
        expect(board.setMarked).toHaveBeenLastCalledWith(['flow-node-0']);
    });

    // The click after the box belongs to the gesture just ended, not to the canvas under it:
    // it must not clear the set the box has just picked out.
    it('does not clear the set on the click its own release carries', () => {
        showBoard();

        pullTo(0, 0, 300, 130);
        fireEvent.click(canvasEl());

        expect(board.select).not.toHaveBeenCalled();
    });

    // With Ctrl held the box adds: the set it found stays picked, and the opening stays open —
    // picking out more cards must not throw away the box somebody is typing in.
    it('adds to the set with Ctrl held, leaving the opening alone', () => {
        board.selected = 'flow-node-2';
        board.marked = ['flow-node-2'];
        showBoard();

        pullTo(0, 0, 300, 130, true);

        expect(board.select).not.toHaveBeenCalled();
        expect(board.setMarked).toHaveBeenLastCalledWith(['flow-node-2', 'flow-node-0']);
    });

    // Shrinking an adding box unpicks its own cards again — but the ones picked out before
    // the gesture stay picked.
    it('unpicks its own cards again as an adding box shrinks', () => {
        board.marked = ['flow-node-2'];
        showBoard();
        const canvas = canvasEl();

        pointer('pointerdown', canvas, 0, 0, true);
        pointer('pointermove', canvas, 300, 300, true);
        expect(board.setMarked).toHaveBeenLastCalledWith(['flow-node-2', 'flow-node-0', 'flow-node-1']);

        pointer('pointermove', canvas, 300, 130, true);
        expect(board.setMarked).toHaveBeenLastCalledWith(['flow-node-2', 'flow-node-0']);

        pointer('pointerup', canvas, 300, 130, true);
    });

    it('picks out classes beside the nodes', async () => {
        const { newFlowNodeClass } = await import('../flowNodeClass');
        const flowNode = { ...newFlowNode('One'), id: 'flow-node-0' };
        const flowNodeClass = { ...newFlowNodeClass('ai'), id: 'class-0', title: 'Shape' };
        board.content = { flowNodes: [flowNode], flowNodeClasses: [flowNodeClass] };
        render(<BoardWithStrip handle="board" />);

        pullTo(0, 0, 300, 300);

        expect(board.setMarked).toHaveBeenLastCalledWith(['flow-node-0', 'class-0']);
    });

    it('is no box where the press started on a card', () => {
        showBoard();
        const one = card('One');

        // The move's handle, or the click that opens it — the canvas answers everywhere else.
        pointer('pointerdown', one, 50, 50);
        pointer('pointermove', one, 300, 300);
        pointer('pointerup', one, 300, 300);

        expect(board.setMarked).not.toHaveBeenCalled();
        expect(screen.queryByTestId('box-select-rect')).toBeNull();
    });

    // A press that does not travel is the click on the empty canvas that clears — unchanged
    // by the box answering beside it.
    it('still clears on a click that went nowhere', () => {
        board.selected = 'flow-node-0';
        showBoard();
        const canvas = canvasEl();

        pointer('pointerdown', canvas, 400, 400);
        pointer('pointerup', canvas, 400, 400);
        fireEvent.click(canvas);

        expect(board.setMarked).not.toHaveBeenCalled();
        expect(board.select).toHaveBeenCalledWith(null);
    });
});

/**
 * The workflows on the canvas: a rectangle round each group of cards, named by its label —
 * clicked open in the workflow panel, and filed from the card menu where several cards are
 * picked out.
 */
describe('workflows on the canvas', () => {
    /** Two grouped cards beside an ungrouped one, under a named rectangle. */
    const showGrouped = () => {
        const flowNodes = ['One', 'Two', 'Three'].map((title, rank) => ({
            ...newFlowNode(title),
            id: `flow-node-${rank}`,
            spot: { x: rank * 300, y: 0 },
            workflow: rank < 2 ? 'w1' : '',
        }));
        board.content = {
            flowNodes, flowNodeClasses: [],
            workflows: [{ id: 'w1', name: 'Sprint' }], workflowClasses: [],
        };
        return render(<BoardWithStrip handle="board" />);
    };

    /** The card by its title. */
    const card = (title: string) =>
        screen.getAllByTestId('flow-node-card').find(element => element.textContent?.includes(title))!;

    beforeEach(() => {
        vi.clearAllMocks();
        board.marked = [];
        board.selected = null;
    });
    afterEach(() => { board.marked = []; board.selected = null; });

    // The rectangle fits its members with a small padding, and its label names it.
    it('draws a rectangle round grouped cards, named by its label', () => {
        showGrouped();

        const rects = screen.getAllByTestId('content-workflow');
        expect(rects).toHaveLength(1);
        expect(screen.getByTestId('content-workflow-label').textContent).toBe('Sprint');
    });

    // The cards stand over the rectangles: a rectangle under its members says which cards are
    // grouped, and the cards on it stay the things to press — selectable even where the open
    // rectangle is drawn solid.
    it('draws the cards over the rectangles', () => {
        // Found from wherever vitest was started: the package itself, or the repository root.
        const cssPath = [
            'src/plugins/hybridflow-ui/Hybridflow.module.css',
            'exchange/dashboard/src/plugins/hybridflow-ui/Hybridflow.module.css',
        ].map(one => resolve(process.cwd(), one)).find(one => existsSync(one));
        expect(cssPath, 'Hybridflow.module.css is found').toBeDefined();
        const css = readFileSync(cssPath as string, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        const zIndexOf = (selector: string): number | null => {
            const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
            for (const [, selectors, body] of rules) {
                if (!selectors.split(',').map(one => one.trim()).includes(selector)) continue;
                const found = body.match(/z-index:\s*(\d+)/);
                if (found) return Number.parseInt(found[1], 10);
            }
            return null;
        };
        const cards = zIndexOf('.boardCard');
        const rectangles = zIndexOf('.workflowRect');
        expect(cards, 'cards wear a z-index').not.toBeNull();
        expect(rectangles, 'rectangles wear a z-index').not.toBeNull();
        expect(cards!).toBeGreaterThan(rectangles!);
    });

    // A rectangle with nothing on screen draws nothing: its members are all held back by the
    // filter, or gone altogether.
    it('draws no rectangle where the workflow has no members on screen', () => {
        board.content = {
            flowNodes: [{ ...newFlowNode('One'), id: 'flow-node-0', spot: { x: 0, y: 0 } }],
            flowNodeClasses: [],
            workflows: [{ id: 'w1', name: 'Sprint' }], workflowClasses: [],
        };
        render(<BoardWithStrip handle="board" />);

        expect(screen.queryByTestId('content-workflow')).toBeNull();
    });

    // A click inside the rectangle but outside any card opens the rectangle: the workflow's
    // own edit, straight into the workflow's own panel — no held-back panel, a rectangle having
    // no double-click to wait out.
    it('opens the workflow in its panel on a click inside the rectangle', () => {
        showGrouped();
        fireEvent.click(screen.getByTestId('content-workflow'));

        expect(board.selectWorkflow).toHaveBeenCalledWith({ kind: 'workflow', id: 'w1' });
        expect(toolBars.showTab).toHaveBeenCalledWith(WORKFLOW_TAB_ID);
        expect(board.select).not.toHaveBeenCalled();
    });

    // Filing the rectangle: the card menu offers one round the aimed set, and the panel
    // it opens is where the rectangle is named.
    it('files a workflow round the marked cards from the card menu', async () => {
        board.marked = ['flow-node-0', 'flow-node-1'];
        const flowNodes = ['One', 'Two', 'Three'].map((title, rank) => ({ ...newFlowNode(title), id: `flow-node-${rank}` }));
        board.content = { flowNodes };
        render(<BoardWithStrip handle="board" />);

        fireEvent.contextMenu(card('One'));
        await act(async () => { await Promise.resolve(); });
        fireEvent.click(screen.getByText('Create workflow (2 nodes)'));

        expect(board.createWorkflow).toHaveBeenCalledWith(['flow-node-0', 'flow-node-1']);
        expect(toolBars.showTab).toHaveBeenCalledWith(WORKFLOW_TAB_ID);
    });

    // One card takes a rectangle of its own: the menu offers a Create where the aimed
    // set is one, and the panel it opens is where the rectangle is named.
    it('files a workflow round a single card from the card menu', async () => {
        const flowNodes = ['One', 'Two'].map((title, rank) => ({ ...newFlowNode(title), id: `flow-node-${rank}` }));
        board.content = { flowNodes };
        render(<BoardWithStrip handle="board" />);

        fireEvent.contextMenu(card('One'));
        await act(async () => { await Promise.resolve(); });
        fireEvent.click(screen.getByText('Create workflow (1 node)'));

        expect(board.createWorkflow).toHaveBeenCalledWith(['flow-node-0']);
        expect(toolBars.showTab).toHaveBeenCalledWith(WORKFLOW_TAB_ID);
    });
});

/**
 * The board's one relation layer: above the workflow backgrounds and below the cards — within one
 * workflow, across workflows, grouped or not, every arrow is drawn there, so no rectangle clips
 * one. Each stroke takes the pointer while the empty sheet passes it through to the rectangle or
 * the board underneath.
 */
describe('the shared relation layer', () => {
    /** Two cards grouped in w1 chained together, one grouped in w2 chained from w1, one ungrouped
     * chained from w2: within, across, and out of workflows. */
    const showLayered = () => {
        board.content = {
            flowNodes: [
                {
                    ...newFlowNode('One'), id: 'flow-node-0', spot: { x: 0, y: 0 }, workflow: 'w1',
                    onSuccess: { flowNode: 'flow-node-1', flowNodes: [], mode: 'continue' as const, compact: false },
                },
                {
                    ...newFlowNode('Two'), id: 'flow-node-1', spot: { x: 400, y: 0 }, workflow: 'w1',
                    onSuccess: { flowNode: 'flow-node-2', flowNodes: [], mode: 'continue' as const, compact: false },
                },
                {
                    ...newFlowNode('Three'), id: 'flow-node-2', spot: { x: 800, y: 0 }, workflow: 'w2',
                    onSuccess: { flowNode: 'flow-node-3', flowNodes: [], mode: 'end' as const, compact: false },
                },
                { ...newFlowNode('Four'), id: 'flow-node-3', spot: { x: 1200, y: 0 } },
            ],
            flowNodeClasses: [],
            workflows: [{ id: 'w1', name: 'First' }, { id: 'w2', name: 'Second' }],
            workflowClasses: [],
        };
        return render(<BoardWithStrip handle="board" />);
    };

    /** The stylesheet's rule for one selector, comments aside. */
    const ruleOf = (selector: string): string | null => {
        // Found from wherever vitest was started: the package itself, or the repository root.
        const cssPath = [
            'src/plugins/hybridflow-ui/Hybridflow.module.css',
            'exchange/dashboard/src/plugins/hybridflow-ui/Hybridflow.module.css',
        ].map(one => resolve(process.cwd(), one)).find(one => existsSync(one));
        expect(cssPath, 'Hybridflow.module.css is found').toBeDefined();
        const css = readFileSync(cssPath as string, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
            if (selectors.split(',').map(one => one.trim()).includes(selector)) return body;
        }
        return null;
    };

    beforeEach(() => {
        vi.clearAllMocks();
        board.marked = [];
        board.selected = null;
    });
    afterEach(() => { board.marked = []; board.selected = null; });

    // Within one workflow, across two, and out to an ungrouped card: every arrow in the one
    // sheet, each naming the relation it draws for whatever reads the pointer next.
    it('draws every relation in the one layer: within, across and out of workflows', () => {
        showLayered();

        const drawn = screen.getAllByTestId('content-link');
        expect(drawn.map(one => [one.dataset.from, one.dataset.to])).toEqual([
            ['flow-node-0', 'flow-node-1'],
            ['flow-node-1', 'flow-node-2'],
            ['flow-node-2', 'flow-node-3'],
        ]);
        expect(screen.getAllByTestId('content-links')).toHaveLength(1);
    });

    // Rectangles at the back, relations above them, cards on top: the paint order in the
    // document and in the stacking the stylesheet declares.
    it('draws the rectangles under the relations and the relations under the cards', () => {
        showLayered();

        const rect = screen.getAllByTestId('content-workflow')[0];
        const links = screen.getByTestId('content-links');
        const card = screen.getAllByTestId('content-card')[0];
        expect(rect.compareDocumentPosition(links) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(links.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        const zIndex = (selector: string): number | null => {
            const found = ruleOf(selector)?.match(/z-index:\s*(\d+)/);
            return found ? Number.parseInt(found[1], 10) : null;
        };
        const rectangles = zIndex('.workflowRect');
        const relations = zIndex('.boardLinks');
        const cards = zIndex('.boardCard');
        expect(rectangles, 'rectangles wear a z-index').not.toBeNull();
        expect(relations, 'relations wear a z-index').not.toBeNull();
        expect(cards, 'cards wear a z-index').not.toBeNull();
        expect(rectangles!).toBeLessThan(relations!);
        expect(relations!).toBeLessThan(cards!);
    });

    // The empty sheet lets the browser target the rectangle or the board underneath; each
    // stroke answers its own pointer, which is what a hovered arrow's title reads.
    it('passes the empty sheet through while each stroke takes its own pointer', () => {
        expect(ruleOf('.boardLinks')).toContain('pointer-events: none');
        expect(ruleOf('.boardLink')).toContain('pointer-events: stroke');
        expect(ruleOf('.boardLinkEnds')).toContain('pointer-events: stroke');
    });

    // The layer moved; the arrows did not change: every one keeps its head, and the chat
    // carried on stays solid beside the fresh start's dashes.
    it('keeps the arrowheads and the solid and dashed styles', () => {
        showLayered();

        const drawn = screen.getAllByTestId('content-link');
        expect(drawn).toHaveLength(3);
        for (const one of drawn) {
            expect(one.getAttribute('marker-end')).toBe('url(#board-arrow-head)');
        }
        expect(drawn[0].getAttribute('class')).toContain(styles.boardLink);
        expect(drawn[1].getAttribute('class')).toContain(styles.boardLink);
        expect(drawn[2].getAttribute('class')).toContain(styles.boardLinkEnds);
        expect(drawn[2].querySelector('title')?.textContent).toContain('hands on to');
    });
});
