import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent, within } from 'src/test/render';
import { FlowNodeCard, FlowNodeChainProps, FlowNodeMenuProps, FlowNodeNextProps, FlowNodePlayProps } from './FlowNodeCard';
import { newFlowNode } from '../boardContent';
import { FlowNodeSettings } from '../flowNodeSettings';
import { TransitionMode } from '../flowNodeSuccess';
import { retryClock } from '../usePlayFlowNode';
import { scheduleLabel } from '../flowNodeSchedule';
import styles from '../Hybridflow.module.css';

// The tag chips are a capability the `tags` plugin publishes; the board asks for it by name and
// wears nothing where nothing published it. Stubbed here, because a list read out of
// `kiao-user-config` is not this test's subject.
vi.mock('@cms-kit/capabilities', async importOriginal => ({
    ...(await importOriginal<typeof import('@cms-kit/capabilities')>()),
    useTagsUi: (await import('src/test/mocks')).tagUiMock,
}));

vi.mock('@cms-core', async importOriginal => ({
    ...(await importOriginal<typeof import('@cms-core')>()),
    ConfiguredMarkdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

// The managed agents the settings chip resolves its name from. One of them, because the card reads
// a name off the list and wears what the settings say where the list has nothing.
vi.mock('../Agents-ctx', () => ({
    useAgents: () => ({
        agents: [{ id: 'agent-1', name: 'Reviewer', platform: 'claude', model: 'opus' }],
        loading: false,
        error: null,
    }),
}));

const onOpen = vi.fn();
const onMark = vi.fn();
const onExpand = vi.fn();
const onPlay = vi.fn();
const onStop = vi.fn();

const noop = vi.fn();
const pointerProps = {
    onPointerDown: noop, onPointerMove: noop, onPointerUp: noop, onPointerCancel: noop,
    onLostPointerCapture: noop,
};
const dragProps = pointerProps;
const chainProps: FlowNodeChainProps = { knobProps: pointerProps, source: false, target: false };

const menu: FlowNodeMenuProps = {
    onClone: noop, onCopy: noop, onCut: noop,
    onArchive: noop, onDelete: noop, copying: 1, cutting: 1, archiving: 1, deleting: 1,
};

const flowNodeOf = (body = '', settings: FlowNodeSettings = {}, mode: TransitionMode = 'end', compact = false) =>
    newFlowNode('Mine', body, settings, { flowNode: '', flowNodes: [], mode, compact });

const onOpenChat = vi.fn();

const show = (
    flowNode: ReturnType<typeof flowNodeOf>,
    play: FlowNodePlayProps | null,
    next: FlowNodeNextProps | null = null,
    chain: FlowNodeChainProps | null = chainProps,
    chat: (() => void) | null = null,
) => render(
    <FlowNodeCard
        flowNode={flowNode}
        next={next}
        chain={chain}
        onOpenChat={chat}
        onUnlinkClass={null}
        selected={false}
        play={play}
        menu={menu}
        onOpen={onOpen}
        onMark={onMark}
        onExpand={onExpand}
        onKeyDown={noop}
        cardClass={undefined}
        dragProps={dragProps}
    />,
);

const idle: FlowNodePlayProps = { state: 'idle', onPlay, onStop };

/** The bubbles at the foot of the card, in the order they are worn. */
const chips = () => screen.queryAllByTestId('flow-node-card-chip').map(chip => chip.textContent);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('FlowNodeCard', () => {
    it('offers a Play of its own', () => {
        show(flowNodeOf('body'), idle);
        fireEvent.click(screen.getByTestId('play-flow-node'));
        expect(onPlay).toHaveBeenCalled();
    });

    // The card underneath opens flow nodes, and a click meant for the button is not that.
    it('keeps the click to itself', () => {
        show(flowNodeOf('body'), idle);
        fireEvent.click(screen.getByTestId('play-flow-node'));
        expect(onPlay).toHaveBeenCalled();
        expect(onOpen).not.toHaveBeenCalled();
    });

    // The panel is as wide as the tool bar tab, which is no width for a flow node with sub-headings in it.
    it('opens the flow node in the large editor on a double-click', () => {
        show(flowNodeOf('body'), idle);
        fireEvent.doubleClick(screen.getByTestId('flow-node-card'));
        expect(onExpand).toHaveBeenCalled();
    });

    // The play's Stop lives on the card it is on.
    it('turns into the play’s Stop on the flow node it is on', () => {
        show(flowNodeOf(), { state: 'playing', onPlay, onStop });

        const button = screen.getByTestId('flow-node-card-playing');
        expect(button).toBeEnabled();
        fireEvent.click(button);
        expect(onStop).toHaveBeenCalled();
        expect(onPlay).not.toHaveBeenCalled();
        expect(screen.queryByTestId('play-flow-node')).toBeNull();
        // No line of its own: the agent bubble at the foot carries the progress mark instead.
        expect(screen.queryByTestId('flow-node-card-state')).toBeNull();
        expect(screen.getByTestId('flow-node-card-running-icon')).toHaveAttribute('aria-label', 'In progress');
        expect(chips()).toEqual(['Claude']);
    });

    // The agent bubble names the agent running the card, by the name the store keeps for the id —
    // the same name the foot of a settled card wears — with the progress mark beside it.
    it('names the agent on the flow node it is on', () => {
        show(flowNodeOf('body', { agent: 'agent-1' }), { state: 'playing', onPlay, onStop });
        expect(screen.queryByTestId('flow-node-card-state')).toBeNull();
        expect(screen.getByTestId('flow-node-card-running-icon')).toHaveAttribute('aria-label', 'In progress');
        expect(chips()).toEqual(['Reviewer']);
    });

    // Once the play is stopping there is nothing left to ask of it: the turn under way finishes.
    it('has nothing to press while the play is already stopping', () => {
        show(flowNodeOf(), { state: 'stopping', onPlay, onStop });
        expect(screen.getByTestId('flow-node-card-stopping')).toBeDisabled();
        expect(screen.getByTestId('flow-node-card-state')).toHaveTextContent('Stopping after this node…');
    });

    // A flow node whose turn came back an error that passes is not being worked on: it is being waited
    // over, for twenty minutes, and a spinner would say the board was busy with it.
    it('shows a flow node waiting to be played again as waiting, and says when', () => {
        const at = new Date('2026-08-24T15:04:00').getTime();
        show(flowNodeOf(), { state: 'waiting', retryAt: at, onPlay, onStop });

        const button = screen.getByTestId('flow-node-card-waiting');
        expect(button.getAttribute('aria-label')).toContain(retryClock(at));
        expect(screen.getByTestId('flow-node-card-state')).toHaveTextContent(retryClock(at));
        expect(screen.queryByTestId('play-flow-node')).toBeNull();
        expect(screen.queryByTestId('flow-node-card-playing')).toBeNull();
        // A wait has no turn to let finish, so Stop there is the end of it now.
        fireEvent.click(button);
        expect(onStop).toHaveBeenCalled();
    });

    // Several chain runs play at once, so a card is not made inert by a play elsewhere: what is
    // refused is a second run on *this* card, and that card is showing a Stop rather than a Play.
    it('is offered while another play is under way', () => {
        show(flowNodeOf(), { state: 'idle', onPlay, onStop });
        expect(screen.getByTestId('play-flow-node')).toBeEnabled();
    });

    // Where there is no Claude at all, or the flow node is not its, there is no button to press.
    it('has no Play when it is given none', () => {
        show(flowNodeOf(), null);
        expect(screen.queryByTestId('play-flow-node')).toBeNull();
    });

    // A card settled on all four wears one bubble: its agent, by the name the store keeps for
    // the id. The other three are read in the panel, where they are set.
    it('wears the agent, and nothing else a settled flow node is run with', () => {
        show(flowNodeOf('body', {
            agent: 'agent-1', effort: 'medium', permission: 'bypassPermissions',
            folder: 'exchange',
        }), idle);
        expect(chips()).toEqual(['Reviewer']);
        expect(screen.queryByTestId('flow-node-card-invalid')).toBeNull();
    });

    // A card written before managed agents wears its model, as it always did: the engine in its
    // agent is no id of the list, and the model is still the one word that says what it costs.
    it('wears the model of a card written before managed agents', () => {
        show(flowNodeOf('body', {
            agent: 'claude', model: 'opus', effort: 'medium', permission: 'bypassPermissions',
            folder: 'exchange',
        }), idle);
        expect(chips()).toEqual(['opus']);
        expect(screen.queryByTestId('flow-node-card-invalid')).toBeNull();
    });

    // Part of a block is not a choice: the card carries no Play button, and one mark says so.
    // What is missing is not listed — the panel highlights each field.
    it('shows one mark, and no list, for a node still waiting on its settings', () => {
        show(flowNodeOf('body', { model: 'opus' }), null);
        const mark = screen.getByTestId('flow-node-card-invalid');
        expect(mark.getAttribute('aria-label')).toContain('Incomplete');
        expect(chips()).toEqual([]);
        expect(screen.queryByTestId('flow-node-card-settings')).toBeNull();
    });

    // An id the store does not hold is an agent that has gone: the card names nothing to play
    // it, so it wears the mark — and the panel highlights the agent box.
    it('marks a node whose agent the store does not hold', () => {
        show(flowNodeOf('body', {
            agent: 'agent-gone', effort: 'medium', permission: 'bypassPermissions', folder: 'exchange',
        }), idle);
        expect(screen.getByTestId('flow-node-card-invalid')).toBeTruthy();
        expect(chips()).toEqual([]);
    });

    // A flow node saying nothing about what runs it is nobody's to play: a card somebody does by hand
    // wears no bubbles at all — and no mark, since there is nothing it is missing.
    it('says nothing about a flow node that says nothing', () => {
        show(flowNodeOf('body'), idle);
        expect(screen.queryByTestId('flow-node-card-settings')).toBeNull();
        expect(screen.queryByTestId('flow-node-card-invalid')).toBeNull();
    });
});

// A tag is worn, not summarised: the word is the whole of it, and the colour is the store's.
// What the card owes its tags is that it hands them on, in the order it carries them. What one
// then *looks* like is the publisher's — see `plugins/tags/TagChip.test.tsx`.
describe('FlowNodeCard — the tags it is filed under', () => {
    it('hands the words it carries to the chips', () => {
        show({ ...flowNodeOf('body'), tags: ['bug', 'later'] }, idle);
        expect(screen.getAllByTestId('tag-chip').map(chip => chip.textContent)).toEqual(['bug', 'later']);
    });

    it('says nothing for a card wearing none', () => {
        show(flowNodeOf('body'), idle);
        expect(screen.queryByTestId('tag-chip')).toBeNull();
    });
});

// The four types are four different things to press, and a board of forty cards is read before it
// is opened: what a card *is* has to be legible without opening one.
describe('FlowNodeCard — what kind of card it is', () => {
    /** The glyph in the card's title line, by the antd name of the icon drawn there. */
    const glyph = (): string | undefined => Array.from(
        document.querySelectorAll('[data-testid="flow-node-card"] .anticon'),
    ).map(mark => Array.from(mark.classList).find(name => name.startsWith('anticon-')))
        .find(name => name !== undefined);

    // Nobody plays a Human card, so the slot the Play would sit in was empty — and an empty slot is
    // exactly what a half-answered AI card has. The one distinction a board is read for said
    // nothing at all.
    it('marks a Human card where a played one carries its button', () => {
        show({ ...flowNodeOf(), type: 'human' }, null);
        const mark = screen.getByTestId('flow-node-card-kind');
        expect(mark).toHaveAttribute('data-type', 'human');
        expect(mark.getAttribute('aria-label')).toContain('by hand');
        expect(glyph()).toBe('anticon-user');
    });

    // An AI card with no Play says so at its foot — the one mark an incomplete node wears —
    // so a mark saying it is an AI card would be the one thing it does not need told.
    it('leaves an AI card unmarked', () => {
        show(flowNodeOf('body', { model: 'opus' }), null);
        expect(screen.queryByTestId('flow-node-card-kind')).toBeNull();
        expect(screen.getByTestId('flow-node-card-invalid')).toBeTruthy();
    });

    // The shape is no button: a Shutdown is never played directly, so it wears its power mark
    // and a click on it opens the node the way a click on a card does.
    it('marks a Shutdown with a power mark of its own, and no Play', () => {
        show({ ...flowNodeOf(), type: 'shutdown' }, null);
        const mark = screen.getByTestId('flow-node-card-kind');
        expect(mark).toHaveAttribute('data-type', 'shutdown');
        expect(mark.getAttribute('aria-label')).toContain('Turns the machine off');
        expect(glyph()).toBe('anticon-poweroff');
        expect(screen.queryByTestId('play-flow-node')).toBeNull();
        fireEvent.click(screen.getByTestId('flow-node-card'));
        expect(onOpen).toHaveBeenCalled();
        expect(onPlay).not.toHaveBeenCalled();
    });

    it('marks a Scheduler with a clock of its own when no play action is supplied', () => {
        show({ ...flowNodeOf(), type: 'scheduler', at: '2026-09-03T22:00' }, null);
        const mark = screen.getByTestId('flow-node-card-kind');
        expect(mark).toHaveAttribute('data-type', 'scheduler');
        expect(mark.getAttribute('aria-label')).toContain('Waits for a duration or datetime');
        expect(glyph()).toBe('anticon-field-time');
        expect(screen.queryByTestId('play-flow-node')).toBeNull();
    });

    // The BPMN parallel-gateway mark — a plus with no diamond round it, the diamond it sits in
    // being the shape's own ring.
    it('marks a Gateway with a plus of its own, and no Play', () => {
        show({ ...flowNodeOf(), type: 'gateway' }, null);
        const mark = screen.getByTestId('flow-node-card-kind');
        expect(mark).toHaveAttribute('data-type', 'gateway');
        expect(mark.querySelector('svg')).not.toBeNull();
        expect(mark.querySelector('rect')).toBeNull();
        expect(screen.queryByTestId('play-flow-node')).toBeNull();
    });

    // The same marks while a run holds the node: the state is drawn where the run is, and there
    // is still nothing to press — the run is stopped from the chain runs panel.
    it('marks the three the board plays to itself while a run holds them, with no Stop', () => {
        show({ ...flowNodeOf(), type: 'scheduler', at: '2026-09-03T22:00' },
            { state: 'scheduled' });
        expect(screen.getByTestId('flow-node-card-kind')).toHaveAttribute('data-type', 'scheduler');
        expect(screen.queryByTestId('play-flow-node')).toBeNull();
        expect(screen.queryByTestId('flow-node-card-playing')).toBeNull();
    });

    it('keeps the ordinary Play on an AI card', () => {
        show(flowNodeOf('body', {
            agent: 'claude', model: 'opus', effort: 'high', permission: 'manual', folder: '/',
        }), idle);
        expect(glyph()).toBe('anticon-play-circle');
    });
});

// The description is not on the card: it is read in the panel and in the large editor, whole.
describe('FlowNodeCard — the description', () => {
    it('is nowhere on the card', () => {
        show(flowNodeOf('Read **the** `board.json` and [the notes](/notes.md)'), idle);
        expect(screen.queryByTestId('flow-node-card-lead')).toBeNull();
        expect(screen.getByTestId('flow-node-card').textContent).not.toContain('board.json');
    });
});

describe('FlowNodeCard — where the flow node stands', () => {
    it('says nothing for a flow node waiting to be done', () => {
        show(flowNodeOf('body'), idle);
        expect(screen.queryByTestId('flow-node-card-state')).toBeNull();
    });

    // A usage limit is not twenty minutes and not an error: the run is holding the flow node until the
    // window comes round, which is hours of nothing happening, and the card says as much rather than
    // spinning over it.
    it('shows a flow node held for a usage limit as waiting for the refresh, and says when', () => {
        const at = new Date('2026-08-24T19:11:00').getTime();
        show(flowNodeOf(), { state: 'refreshing', retryAt: at, onPlay, onStop });

        const button = screen.getByTestId('flow-node-card-refreshing');
        expect(button.getAttribute('aria-label')).toContain(retryClock(at));
        expect(button.getAttribute('aria-label')).toContain('usage limit');
        const note = screen.getByTestId('flow-node-card-state');
        expect(note).toHaveTextContent('Waiting refresh');
        expect(note).toHaveTextContent(retryClock(at));
        expect(screen.queryByTestId('play-flow-node')).toBeNull();
        expect(screen.queryByTestId('flow-node-card-waiting')).toBeNull();
        // Nothing is running, so Stop there is the end of the wait now.
        fireEvent.click(button);
        expect(onStop).toHaveBeenCalled();
    });

    it('does not invent a reset time when the run reports none', () => {
        show(flowNodeOf(), { state: 'refreshing', retryAt: null, onPlay, onStop });
        expect(screen.getByTestId('flow-node-card-state')).toHaveTextContent(/^Waiting refresh$/);
        expect(screen.getByTestId('flow-node-card-refreshing')).toHaveAttribute(
            'aria-label', 'The usage limit was reached; waiting for the reset — stop the play',
        );
    });

    it('says so for a flow node that is done, and for one that came back an error', () => {
        show({ ...flowNodeOf('body'), status: 'done' }, idle);
        expect(screen.getByTestId('flow-node-card-state')).toHaveTextContent('Done');
        expect(screen.getByTestId('flow-node-card')).toHaveAttribute('data-status', 'done');
    });

    it('marks one whose turn came back an error', () => {
        show({ ...flowNodeOf('body'), status: 'error' }, idle);
        expect(screen.getByTestId('flow-node-card-state')).toHaveTextContent('Error');
        expect(screen.getByTestId('flow-node-card')).toHaveAttribute('data-status', 'error');
    });

    // The four the play does not end on: one still being written, one it is holding now, one it is
    // holding and can do nothing with, and one it was holding when somebody stopped it.
    it('marks a draft, a flow node under way, one held for a limit and one stopped part-way', () => {
        const draft = show({ ...flowNodeOf('body'), status: 'draft' }, idle);
        expect(screen.getByTestId('flow-node-card-state')).toHaveTextContent('Draft');
        draft.unmount();

        const running = show({ ...flowNodeOf('body'), status: 'running' }, idle);
        expect(screen.getByTestId('flow-node-card-state')).toHaveTextContent('In progress');
        running.unmount();

        const held = show({ ...flowNodeOf('body'), status: 'waiting-refresh' }, idle);
        expect(screen.getByTestId('flow-node-card-state')).toHaveTextContent('Waiting refresh');
        expect(screen.getByTestId('flow-node-card')).toHaveAttribute('data-status', 'waiting-refresh');
        held.unmount();

        show({ ...flowNodeOf('body'), status: 'interrupted' }, idle);
        expect(screen.getByTestId('flow-node-card-state')).toHaveTextContent('Interrupted');
        expect(screen.getByTestId('flow-node-card')).toHaveAttribute('data-status', 'interrupted');
    });

    // While a play is on it, what the board is doing is the news; yesterday's mark is not.
    it('says what the play is doing rather than where the flow node stood', () => {
        show({ ...flowNodeOf('body'), status: 'done' }, { state: 'playing', onPlay, onStop });
        expect(screen.queryByTestId('flow-node-card-state')).toBeNull();
        expect(screen.getByTestId('flow-node-card')).not.toHaveTextContent('Done');
        expect(screen.getByTestId('flow-node-card-running-icon')).toHaveAttribute('aria-label', 'In progress');
        expect(chips()).toEqual(['Claude']);
    });
});

// The colour is the whole of what a `ready` card says about where it stands, and the fastest thing
// to read on the other two: a board of forty cards is scanned rather than read.
describe('FlowNodeCard — the status stripe', () => {
    it('stripes a card waiting to be done', () => {
        show(flowNodeOf('body'), idle);
        expect(screen.getByTestId('flow-node-card')).toHaveClass(styles.cardReady);
    });

    it('stripes a done card, and colours the line that names it', () => {
        show({ ...flowNodeOf('body'), status: 'done' }, idle);
        expect(screen.getByTestId('flow-node-card')).toHaveClass(styles.cardDone);
        expect(screen.getByTestId('flow-node-card-state')).toHaveClass(styles.cardStateDone);
    });

    it('stripes a card that came back an error, and colours the line that names it', () => {
        show({ ...flowNodeOf('body'), status: 'error' }, idle);
        expect(screen.getByTestId('flow-node-card')).toHaveClass(styles.cardFailed);
        expect(screen.getByTestId('flow-node-card-state')).toHaveClass(styles.cardStateBad);
    });

    it('gives a draft, a running flow node and an interrupted one a colour of their own', () => {
        const draft = show({ ...flowNodeOf('body'), status: 'draft' }, idle);
        expect(screen.getByTestId('flow-node-card')).toHaveClass(styles.cardDraft);
        expect(screen.getByTestId('flow-node-card-state')).toHaveClass(styles.cardStateDraft);
        draft.unmount();

        const running = show({ ...flowNodeOf('body'), status: 'running' }, idle);
        expect(screen.getByTestId('flow-node-card')).toHaveClass(styles.cardRunning);
        expect(screen.getByTestId('flow-node-card-state')).toHaveClass(styles.cardStateRunning);
        running.unmount();

        show({ ...flowNodeOf('body'), status: 'interrupted' }, idle);
        expect(screen.getByTestId('flow-node-card')).toHaveClass(styles.cardInterrupted);
        expect(screen.getByTestId('flow-node-card-state')).toHaveClass(styles.cardStateInterrupted);
    });

    // The play paints all four edges over the stripe, and there is no status line under the
    // title while it runs: the agent bubble carries the progress mark instead.
    it('leaves the colour of a running card to the play', () => {
        show({ ...flowNodeOf('body'), status: 'error' }, { state: 'playing', onPlay, onStop });
        expect(screen.getByTestId('flow-node-card')).toHaveClass(styles.cardPlaying);
        expect(screen.queryByTestId('flow-node-card-state')).toBeNull();
        expect(screen.getByTestId('flow-node-card-running-icon')).toBeTruthy();
    });
});

// A chain is the only order a board has, and an order nothing on the board shows is one nobody can
// predict.
describe('FlowNodeCard — what comes after the flow node', () => {
    /** A card that names another after it. The knob is the only place the board says so. */
    const nextFlowNode = (): FlowNodeNextProps => ({ title: 'Ship it' });

    // The name of the next flow node is the knob's tooltip and nothing else: a line per card for it is
    // room a board of forty cards has not got.
    it('names the flow node it hands on to nowhere on the card itself', () => {
        show(flowNodeOf('', {}, 'continue'), null, nextFlowNode());
        expect(screen.getByTestId('flow-node-card')).not.toHaveTextContent('Ship it');
    });

    it('says which flow node it hands on to, and what the mode does', () => {
        show(flowNodeOf('', {}, 'continue'), null, nextFlowNode());
        expect(screen.getByTestId('flow-node-card-chain'))
            .toHaveAttribute('title', expect.stringContaining('Next: “Ship it” · forked chat.'));
    });

    // The compaction is the card's own, so it is said with a chain and without one.
    it('says when the chat is shortened once the flow node is done', () => {
        show(flowNodeOf('', {}, 'end', true), null);
        expect(screen.getByTestId('flow-node-card-chain'))
            .toHaveAttribute('title', expect.stringContaining('Chat shortened.'));
    });

    it('says when the conversation ends with this flow node', () => {
        show(flowNodeOf('', {}, 'end'), null, nextFlowNode());
        expect(screen.getByTestId('flow-node-card-chain'))
            .toHaveAttribute('title', expect.stringContaining('· new chat.'));
    });

    it('says nothing of what comes after for a flow node that names none', () => {
        show(flowNodeOf(), null);
        expect(screen.getByTestId('flow-node-card-chain'))
            .toHaveAttribute('title', expect.not.stringContaining('Next:'));
    });

    // The knob's whole tooltip — what it hands on to, what is wrong with it, and the
    // gesture — stays under the repository's 30-word tooltip rule with all three said.
    it('keeps the knob’s whole tooltip under 30 words', () => {
        show(flowNodeOf('', { model: 'opus' }, 'continue', true), null, nextFlowNode());
        const title = screen.getByTestId('flow-node-card-chain').getAttribute('title') ?? '';
        expect(title.split(/\s+/).filter(Boolean).length).toBeLessThan(30);
    });

    // The knob is where a chain is drawn from, and what it shows is the transition mode: empty for
    // a card that ends where it is with nothing to say about it, the mode's glyph for one that does.
    it('carries an empty knob for a flow node that hands on to nothing', () => {
        show(flowNodeOf(), null);
        const knob = screen.getByTestId('flow-node-card-chain');
        expect(knob).not.toHaveAttribute('data-mode');
        expect(knob.querySelector('svg')).toBeNull();
    });

    it('shows the transition mode inside the knob', () => {
        show(flowNodeOf('', {}, 'continue'), null, nextFlowNode());
        const knob = screen.getByTestId('flow-node-card-chain');
        expect(knob).toHaveAttribute('data-mode', 'continue');
        expect(knob.querySelector('svg')).not.toBeNull();
    });

    // The card's own line, where a played one names its model: the three the board plays to itself
    // hold no settings, so what that line says is what the card is.
    describe('the three cards the board plays to itself', () => {
        it('says a Shutdown is one, in a word', () => {
            show({ ...flowNodeOf(), type: 'shutdown' }, null);
            expect(chips()).toEqual(['shutdown']);
            expect(screen.queryByTestId('flow-node-card-invalid')).toBeNull();
        });

        // The datetime is the one thing about a Scheduler worth finding without opening the card.
        it('reads a Scheduler’s datetime out on the card', () => {
            show({ ...flowNodeOf(), type: 'scheduler', at: '2026-09-03T22:00' }, null);
            expect(chips()).toEqual([scheduleLabel('2026-09-03T22:00')]);
            expect(screen.queryByTestId('flow-node-card-invalid')).toBeNull();
        });

        it('marks a Scheduler naming none as incomplete', () => {
            show({ ...flowNodeOf(), type: 'scheduler' }, null);
            expect(screen.getByTestId('flow-node-card-invalid')).toBeTruthy();
            expect(chips()).toEqual([]);
        });

        // The count of branches is the one thing about a Gateway worth finding without opening
        // the card — and none is never missing, a Gateway with none still joining.
        it('reads a Gateway’s branches out on the card', () => {
            show({
                ...flowNodeOf(), type: 'gateway',
                onSuccess: { flowNode: '', flowNodes: ['b', 'a'], mode: 'end', compact: false },
            }, null);
            expect(chips()).toEqual(['2 branches']);
            expect(screen.queryByTestId('flow-node-card-invalid')).toBeNull();
        });

        it('says a Gateway with none still joins', () => {
            show({ ...flowNodeOf(), type: 'gateway' }, null);
            expect(chips()).toEqual(['no branches']);
            expect(screen.queryByTestId('flow-node-card-invalid')).toBeNull();
        });

        // A run holding for the hour is the card doing the one thing it is for: nothing is running
        // and nothing has gone wrong. The state alone is shown — a Scheduler carries no Stop.
        it('says a Scheduler is holding while the run waits it out', () => {
            show({ ...flowNodeOf(), type: 'scheduler', at: '2026-09-03T22:00' },
                { state: 'scheduled' });
            expect(screen.getByTestId('flow-node-card-state')).toHaveTextContent('Waiting for the schedule…');
        });
    });

    // Two of the three modes say the flow node is Claude's. A card saying one of them with nothing to
    // play it is contradicting itself, and the knob is where the board says so.
    describe('a mode the card cannot honour', () => {
        it('marks the knob and says why', () => {
            show(flowNodeOf('', { model: 'opus' }, 'continue'), null);
            const knob = screen.getByTestId('flow-node-card-chain');
            expect(knob).toHaveAttribute('data-broken', 'true');
            expect(knob.className).toContain(styles.chainKnobBroken);
            expect(knob).toHaveAttribute(
                'title', expect.stringContaining('Nothing here can play it.'),
            );
        });

        it('leaves the knob alone for the mode that claims nothing', () => {
            show(flowNodeOf('', {}, 'end'), null);
            expect(screen.getByTestId('flow-node-card-chain')).not.toHaveAttribute('data-broken');
        });
    });

    // The card underneath opens flow nodes, and the press that draws a chain is not that.
    it('keeps the knob’s click off the card', () => {
        show(flowNodeOf(), null);
        fireEvent.click(screen.getByTestId('flow-node-card-chain'));
        expect(onOpen).not.toHaveBeenCalled();
    });

    // A board with no Claude at all has nothing to play, so it has no order to play things in.
    it('has no knob where it is given none', () => {
        show(flowNodeOf(), null, null, null);
        expect(screen.queryByTestId('flow-node-card-chain')).toBeNull();
    });

    // The turn running is somebody else's — the chat's compaction — and the card says so rather
    // than claiming Claude is on this flow node.
    it('tells a chat being shortened from the flow node being worked on', () => {
        show(flowNodeOf(), { state: 'compacting', onPlay: noop, onStop });
        expect(screen.getByTestId('flow-node-card-state')).toHaveTextContent('Shortening its chat…');
        expect(screen.getByTestId('flow-node-card-compacting')).toBeEnabled();
    });
});

// The board is read more than it is edited, and what a played flow node did is in its chat. The mark is
// the one way into it that does not go through opening the flow node first.
describe('FlowNodeCard — the chat it was played in', () => {
    it('opens the conversation from the card', () => {
        show(flowNodeOf('body'), idle, null, chainProps, onOpenChat);
        fireEvent.click(screen.getByTestId('flow-node-card-chat'));
        expect(onOpenChat).toHaveBeenCalled();
    });

    // The card underneath opens the flow node in its panel, and a press meant for the mark is not that.
    it('keeps the click to itself', () => {
        show(flowNodeOf('body'), idle, null, chainProps, onOpenChat);
        fireEvent.click(screen.getByTestId('flow-node-card-chat'));
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('is absent where the flow node has no chat to open', () => {
        show(flowNodeOf('body'), idle);
        expect(screen.queryByTestId('flow-node-card-chat')).toBeNull();
    });
});

// The right-click menu files the card on another board: one item per board but this one, under
// "Move to..." — and the count the way the Copy's reads where several cards are marked.
describe('FlowNodeCard — moving to another board', () => {
    const showWithMove = (move: Partial<FlowNodeMenuProps> = {}) => render(
        <FlowNodeCard
            flowNode={flowNodeOf('body')}
            next={null}
            chain={chainProps}
            onOpenChat={null}
            onUnlinkClass={null}
            selected={false}
            play={idle}
            menu={{ ...menu, ...move }}
            onOpen={onOpen}
            onMark={onMark}
            onExpand={onExpand}
            onKeyDown={noop}
            cardClass={undefined}
            dragProps={dragProps}
        />,
    );

    it('offers the other boards under Move to..., and moves to the one picked', async () => {
        const onMove = vi.fn();
        showWithMove({ moveTargets: [{ slug: 'other', name: 'Other board' }], onMove, moving: 1 });

        fireEvent.contextMenu(screen.getByTestId('flow-node-card'));
        await act(async () => { await Promise.resolve(); });
        fireEvent.mouseEnter(screen.getByText('Move to...'));
        fireEvent.click(await screen.findByTestId('move-to-other'));

        expect(onMove).toHaveBeenCalledWith('other');
    });

    it('says how many cards the move takes, and where there is nowhere to move to', async () => {
        showWithMove({ moveTargets: [], moving: 3 });

        fireEvent.contextMenu(screen.getByTestId('flow-node-card'));
        await act(async () => { await Promise.resolve(); });

        expect(screen.getByText('Move 3 nodes to...')).toBeTruthy();
        fireEvent.mouseEnter(screen.getByText('Move 3 nodes to...'));
        expect(await screen.findByText('No other boards')).toBeTruthy();
    });
});

// A mouse press anywhere on the card starts a move — the grip is gone, and the title has its
// corner back. The card's own controls keep the presses meant for them.
describe('FlowNodeCard — dragging from anywhere', () => {
    const dragDown = vi.fn();
    const knobDown = vi.fn();
    const dragSpies = {
        onPointerDown: dragDown, onPointerMove: noop, onPointerUp: noop, onPointerCancel: noop,
        onLostPointerCapture: noop,
    };

    const showDraggable = () => render(
        <FlowNodeCard
            flowNode={flowNodeOf('body')}
            next={null}
            chain={{ knobProps: { ...dragSpies, onPointerDown: knobDown }, source: false, target: false }}
            onOpenChat={onOpenChat}
            onUnlinkClass={null}
            selected={false}
            play={idle}
            menu={menu}
            onOpen={onOpen}
            onMark={onMark}
            onExpand={onExpand}
            onKeyDown={noop}
            cardClass={undefined}
            dragProps={dragSpies}
        />,
    );

    /** A mouse press on the target, as jsdom has no `PointerEvent` — see `useSpotDrag.test.tsx`. */
    const press = (target: Element) => {
        const event = new MouseEvent('pointerdown', {
            bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 0,
        });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        Object.defineProperty(event, 'pointerType', { value: 'mouse' });
        fireEvent(target, event);
    };

    it('starts a drag from a press anywhere on the card', () => {
        showDraggable();
        press(screen.getByTestId('flow-node-card'));
        expect(dragDown).toHaveBeenCalledTimes(1);
    });

    it('carries no grip anymore', () => {
        showDraggable();
        expect(screen.queryByTestId('flow-node-card-grip')).toBeNull();
    });

    it('keeps the Play’s press off the drag', () => {
        showDraggable();
        press(screen.getByTestId('play-flow-node'));
        expect(dragDown).not.toHaveBeenCalled();
    });

    it('keeps the chat mark’s press off the drag', () => {
        showDraggable();
        press(screen.getByTestId('flow-node-card-chat'));
        expect(dragDown).not.toHaveBeenCalled();
    });

    it('draws a chain from the knob rather than moving the card', () => {
        showDraggable();
        press(screen.getByTestId('flow-node-card-chain'));
        expect(knobDown).toHaveBeenCalledTimes(1);
        expect(dragDown).not.toHaveBeenCalled();
    });
});

// The three the board plays to itself are BPMN symbols rather than cards: an event's circle for
// a Shutdown and a Scheduler, a gateway's diamond for a Gateway, with the label under the shape.
describe('FlowNodeCard — BPMN symbols', () => {
    it('draws a Gateway as a diamond with its branches’ count under it', () => {
        show({
            ...flowNodeOf(), type: 'gateway',
            onSuccess: { flowNode: '', flowNodes: ['b', 'a'], mode: 'end', compact: false },
        }, idle);
        const node = screen.getByTestId('flow-node-card');
        expect(node).toHaveAttribute('data-shape', 'diamond');
        expect(node).toHaveTextContent('Mine');
        expect(chips()).toEqual(['2 branches']);
        expect(screen.queryByTestId('play-flow-node')).toBeNull();
    });

    it('draws a Scheduler as a circle with its datetime under it', () => {
        show({ ...flowNodeOf(), type: 'scheduler', at: '2026-09-03T22:00' }, idle);
        const node = screen.getByTestId('flow-node-card');
        expect(node).toHaveAttribute('data-shape', 'circle');
        expect(node).not.toHaveTextContent('Mine');
        expect(chips()).toEqual([scheduleLabel('2026-09-03T22:00')]);
    });

    it('draws a Shutdown as a circle saying what it is', () => {
        show({ ...flowNodeOf(), type: 'shutdown' }, idle);
        expect(screen.getByTestId('flow-node-card')).toHaveAttribute('data-shape', 'circle');
        expect(chips()).toEqual(['shutdown']);
    });

    it('leaves the two kinds of work as cards', () => {
        const ai = show({ ...flowNodeOf('body'), type: 'ai' }, idle);
        expect(screen.getByTestId('flow-node-card')).not.toHaveAttribute('data-shape');
        ai.unmount();

        show({ ...flowNodeOf(), type: 'human' }, null);
        expect(screen.getByTestId('flow-node-card')).not.toHaveAttribute('data-shape');
    });

    /** A mouse press on the target, as jsdom has no `PointerEvent` — see the drag suite above. */
    const pressAt = (target: Element, clientX: number, clientY: number) => {
        const event = new MouseEvent('pointerdown', {
            bubbles: true, cancelable: true, clientX, clientY, button: 0,
        });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        Object.defineProperty(event, 'pointerType', { value: 'mouse' });
        fireEvent(target, event);
    };

    // The shape is no button: a click on it opens the node, the way a click on a card does.
    it('opens on a click on the shape', () => {
        show({ ...flowNodeOf(), type: 'scheduler', at: '2026-09-03T22:00' }, idle);
        fireEvent.click(screen.getByTestId('flow-node-card-kind'));
        expect(onOpen).toHaveBeenCalled();
        expect(onPlay).not.toHaveBeenCalled();
    });

    // A keyboard opening lands on the node itself, which opens it.
    it('opens the node from the shape with the keyboard', () => {
        show({ ...flowNodeOf(), type: 'scheduler', at: '2026-09-03T22:00' }, idle);
        fireEvent.keyDown(screen.getByTestId('flow-node-card'), { key: 'Enter' });
        expect(onOpen).toHaveBeenCalled();
        expect(onPlay).not.toHaveBeenCalled();
    });

    // The shape is the handle a hand reaches for: a press on it starts a move, and the release
    // opens the node — the board holds the panel back where the press travelled.
    it('starts a move from a press on the shape, and opens on its release', () => {
        const dragDown = vi.fn();
        render(
            <FlowNodeCard
                flowNode={{ ...flowNodeOf(), type: 'scheduler', at: '2026-09-03T22:00' }}
                next={null}
                chain={chainProps}
                onOpenChat={null}
                onUnlinkClass={null}
                selected={false}
                play={idle}
                menu={menu}
                onOpen={onOpen}
                onMark={onMark}
                onExpand={onExpand}
                onKeyDown={noop}
                cardClass={undefined}
                dragProps={{ ...dragProps, onPointerDown: dragDown }}
            />,
        );
        pressAt(screen.getByTestId('flow-node-card-kind'), 100, 100);
        expect(dragDown).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('flow-node-card'), { clientX: 160, clientY: 140 });
        expect(onPlay).not.toHaveBeenCalled();
        expect(onOpen).toHaveBeenCalled();
    });

    // A double-click on the shape is the large editor, the way it is on a card.
    it('opens the large editor on a double-click on the shape', () => {
        show({ ...flowNodeOf(), type: 'scheduler', at: '2026-09-03T22:00' }, idle);
        pressAt(screen.getByTestId('flow-node-card-kind'), 100, 100);
        fireEvent.doubleClick(screen.getByTestId('flow-node-card'));
        expect(onExpand).toHaveBeenCalled();
    });

    it('still opens the large editor on a double-click on the label', () => {
        show({ ...flowNodeOf(), type: 'scheduler', at: '2026-09-03T22:00' }, idle);
        const node = screen.getByTestId('flow-node-card');
        pressAt(node, 100, 200);
        fireEvent.doubleClick(node);
        expect(onExpand).toHaveBeenCalled();
    });

    // No edge to stripe, so the circle or the diamond itself carries the status.
    it('rings the shape in the status colour', () => {
        show({ ...flowNodeOf(), type: 'gateway', status: 'done' }, idle);
        expect(screen.getByTestId('flow-node-card')).toHaveClass(styles.symbolDone);
    });

    it('marks a Scheduler naming no datetime as incomplete', () => {
        show({ ...flowNodeOf(), type: 'scheduler' }, null);
        expect(screen.getByTestId('flow-node-card')).toHaveAttribute('data-shape', 'circle');
        expect(screen.getByTestId('flow-node-card-invalid')).toBeTruthy();
        expect(screen.queryByTestId('play-flow-node')).toBeNull();
    });

    it('draws the chain from the knob at the shape’s edge', () => {
        show({ ...flowNodeOf(), type: 'scheduler', at: '2026-09-03T22:00' }, idle);
        expect(screen.getByTestId('flow-node-card-chain').className).toContain(styles.symbolKnob);
    });
});


describe('Scheduler controls', () => {
    it('plays without opening or dragging the Scheduler and keeps its name off the board', () => {
        const onPlay = vi.fn();
        show({ ...flowNodeOf(), type: 'scheduler', duration: '15m' }, { state: 'idle', onPlay });
        expect(screen.getByTestId('flow-node-card')).not.toHaveTextContent('Mine');
        expect(chips()).toEqual(['Wait 15m']);
        fireEvent.click(screen.getByTestId('play-flow-node'));
        expect(onPlay).toHaveBeenCalledOnce();
        expect(onOpen).not.toHaveBeenCalled();
    });
    it('offers Stop during a duration wait', () => {
        const onStop = vi.fn();
        show({ ...flowNodeOf(), type: 'scheduler', duration: '15m' }, { state: 'scheduled', onStop });
        fireEvent.click(screen.getByTestId('flow-node-card-scheduled'));
        expect(onStop).toHaveBeenCalledOnce();
    });
});

describe('display cards', () => {
    it('renders a note as markdown with no title, tags or status', () => {
        show({ ...newFlowNode(''), type: 'note', title: '', note: 'Hello **board**' }, null, null, null);
        expect(screen.getByTestId('flow-node-note-card')).toHaveTextContent('Hello **board**');
        expect(screen.queryByTestId('flow-node-card-chip')).toBeNull();
        expect(screen.queryByTestId('flow-node-card-state')).toBeNull();
    });

    it('shows only a value title and its kind mark', () => {
        show({ ...newFlowNode('Config'), type: 'value', value: { a: 1 } }, null, null, null);
        const card = screen.getByTestId('flow-node-value-card');
        expect(card).toHaveTextContent(/^Config$/);
        expect(within(card).getByRole('img', { name: 'Value' })).toBeInTheDocument();
        expect(screen.queryByTestId('flow-node-value-copy')).toBeNull();
        expect(screen.queryByTestId('flow-node-value-json')).toBeNull();
        fireEvent.click(card);
        expect(onOpen).toHaveBeenCalledOnce();
    });
});
