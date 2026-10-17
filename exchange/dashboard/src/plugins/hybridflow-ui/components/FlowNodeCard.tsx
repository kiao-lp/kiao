import React from 'react';
import { Dropdown, MenuProps } from 'antd';
import {
    ArrowRightOutlined, BlockOutlined, CheckCircleOutlined, ClockCircleOutlined, ClusterOutlined,
    CopyOutlined, DeleteOutlined, DisconnectOutlined, EditOutlined, ExclamationCircleOutlined,
    ExportOutlined, FieldTimeOutlined, GroupOutlined, InboxOutlined, LoadingOutlined,
    MessageOutlined, MinusCircleOutlined, PauseCircleOutlined, PlayCircleOutlined,
    PoweroffOutlined, ScissorOutlined, StopOutlined, SyncOutlined, UserOutlined,
} from '@ant-design/icons';
import { KEEP_MENU_IN_VIEWPORT, Tooltip } from '@cms-core';
import { useTagsUi } from '@cms-kit/capabilities';
import { useAgents } from '../Agents-ctx';
import { FlowNode } from '../boardContent';
import { scheduleLabel } from '../flowNodeSchedule';
import { SettingChip, settingsChips } from '../flowNodeSettings';
import { READY, STATUS_LABELS, FlowNodeStatus, WAITING_REFRESH } from '../flowNodeStatus';
import { brokenTransition, TransitionMode } from '../flowNodeSuccess';
import { isTask, FlowNodeType } from '../flowNodeType';
import { symbolKindOf } from '../boardSpots';
import { FLOW_NODE_ID_ATTRIBUTE } from '../boardDom';
import { retryClock } from '../usePlayFlowNode';
import styles from '../Hybridflow.module.css';

/**
 * What the card's Play is showing. Null where there is nothing to offer: no Claude, a flow node whose
 * settings do not name what would run it, or a flow node standing anywhere but `ready` — only a `ready`
 * flow node is played, and the run's own card is the one exception, since what it shows is a Stop. See
 * `canPlay` in `flowNodeStatus`.
 *
 * AI cards and Schedulers carry Play and Stop. Shutdowns and Gateways show their run's state;
 * the chain runs panel stops those runs.
 *
 * A Human card never carries this at all: nobody plays it, so no run ever holds it.
 *
 * Everything but `idle` is this card's own play under way, and the button is then a **Stop** — the
 * play's only one, the column header having had it while a column was a thing that got played. It
 * ends the chain rather than the turn: what is running finishes and is marked like any other, and
 * nothing after it is started.
 *
 * **A play elsewhere on the board makes nothing here inert.** Several runs play at once, so what a
 * card refuses is a second run on *itself* — and that card is showing a Stop.
 */
export interface FlowNodePlayProps {
    /**
     * `waiting` is this flow node's turn having come back an error that passes: nothing is running, and
     * the play sends it again at {@link retryAt}. It is a state of its own rather than a longer
     * `playing` because it lasts twenty minutes — and Stop there is the end of the wait now.
     *
     * `refreshing` is the same shape of thing on a longer clock: Claude's usage limit was reached
     * mid-turn, and the play is holding this flow node until the moment that limit lifts — {@link retryAt}
     * again, and hours off as often as not. What goes back in then is not the description but the
     * word that picks the cut-off turn back up, which is why the card says something else.
     *
     * `compacting` is this flow node's own chat being shortened now that the flow node is done, which the card
     * itself asked for: the flow node is answered and marked, and the turn still running in its
     * conversation is the `/compact` that follows it.
     *
     * `scheduled` is a **Scheduler** card holding for its duration or datetime.
     * Nothing is running and nothing has gone wrong: the card is being played, and being played is
     * waiting.
     */
    state: 'idle' | 'playing' | 'compacting' | 'scheduled' | 'waiting' | 'refreshing' | 'stopping';
    /** When the play goes back in. Set only while `waiting` or `refreshing`. */
    retryAt?: number | null;
    /**
     * What the chain run holding this card is called, or null on an idle one. It is what the
     * button says while it is a Stop: three cards of one board may be playing at once, and "Stop
     * the play" would name none of them.
     */
    chainRun?: string | null;
    /**
     * Starts a chain run on this node. Present only where the board offers one: an AI node
     * standing `ready` with something to send. Absent on anything a run is holding — there the
     * control is the Stop — and on anything that is never played directly.
     */
    onPlay?: () => void;
    /**
     * Ends the play after the flow node under way. Present on an AI node or Scheduler a run holds. A
     * Shutdown and a Gateway never carry it: the run one of those is holding is
     * stopped from the chain runs panel.
     */
    onStop?: () => void;
}

/** What the card's right-click menu does. Copy travels as JSON — see `boardClip`. */
export interface FlowNodeMenuProps {
    /**
     * Files a second card just like this one directly under it, and opens it. One card, marks or no
     * marks: the copy goes under the card the menu was opened on, which is the card the gesture
     * named.
     */
    onClone: () => void;
    /**
     * Files a node class from this card — its title, kind and answers become the class's, and
     * its description and success criteria become the first version's. Offered on a task and
     * on nothing else: only work somebody does converts into a reusable shape of it.
     */
    onConvertToClass?: () => void;
    /** Puts this card on the clipboard — or every marked card, where this is one of them. */
    onCopy: () => void;
    /** The same cards on the clipboard, and then off the board: a card on the wrong board. */
    onCut: () => void;
    /** Writes the card out as a dated markdown file beside the board, and takes it off. One card. */
    onArchive: () => void;
    onDelete: () => void;
    /**
     * How many cards the Copy takes: this one, or every marked card where this is one of them. Said
     * in the item for the reason the Delete says it, and because a copy is a gesture whose result is
     * out of sight — the board looks the same afterwards, and the count is the only place the
     * clipboard is described before it is pasted somewhere else.
     */
    copying: number;
    /**
     * How many cards the Cut takes, which is however many the Copy takes: a cut *is* that copy, with
     * the cards taken off once the clipboard has them. Said in the item for the same reason, and
     * with more riding on it — these cards are about to leave the board.
     */
    cutting: number;
    /**
     * How many cards the Delete takes: this one, or every marked card where this is one of them.
     * The item says so, because a menu offering to delete "the flow node" on a card plainly picked out
     * with four others is a menu that lies about what the click does.
     */
    deleting: number;
    /**
     * The other boards, as the "Move to..." submenu lists them — every board but this one, by
     * handle and name. Empty while they are being read, or where there is no other board.
     */
    moveTargets?: { slug: string; name: string }[];
    /** Files this card on the board of that handle — or every marked card, where this is one of them. */
    onMove?: (targetHandle: string) => void;
    /**
     * How many cards the Move takes, which is however many the Copy takes: a move *is* those
     * cards, filed on the board picked from the submenu and taken off this one.
     */
    moving?: number;
    /**
     * Files a workflow round this card — or every marked card, where this is one of them.
     * Offered from one card up: a rectangle round one card is where a second is added.
     */
    onCreateWorkflow?: () => void;
    /** How many cards the workflow groups. Said in the item the way the Copy says it. */
    creating?: number;
}

/** What a flow node hands on to when it comes back an answer, as the card's knob reads it out. */
export interface FlowNodeNextProps {
    title: string;
}

/**
 * The card's knob, and what this card is party to while a chain is being drawn on the board. Null
 * where chains mean nothing at all, which is a build with no Claude Code in it.
 */
export interface FlowNodeChainProps {
    /** The knob's own pointer handlers: a chain is pulled from here — see `useLinkDrag`. */
    knobProps: {
        onPointerDown: React.PointerEventHandler<HTMLElement>;
        onPointerMove: React.PointerEventHandler<HTMLElement>;
        onPointerUp: React.PointerEventHandler<HTMLElement>;
        onPointerCancel: React.PointerEventHandler<HTMLElement>;
        onLostPointerCapture: React.PointerEventHandler<HTMLElement>;
    };
    /** The chain being drawn starts here. */
    source: boolean;
    /** The chain being drawn would land here. */
    target: boolean;
}

interface FlowNodeCardProps {
    flowNode: FlowNode;
    /** The flow node played after this one, or null where none is. */
    next: FlowNodeNextProps | null;
    /** The knob a chain is drawn from, or null where there is none to offer. */
    chain: FlowNodeChainProps | null;
    /**
     * Puts the conversation this flow node was played in on screen, or null where there is none to put
     * there: a flow node never played, one whose chat has been forgotten, or a build without Claude.
     */
    onOpenChat: (() => void) | null;
    /**
     * Breaks the link to the class version the flow node was instantiated from, or null where the
     * flow node names none: a flow node made by hand has nothing to break.
     */
    onUnlinkClass: (() => void) | null;
    /**
     * Drawn picked out: the flow node open in the panel, or a card **marked** with the others a move or
     * a delete is about to take. One look for the two, because they are one thing to the eye — the
     * cards this gesture is aimed at — and a board that shaded them differently would be asking the
     * user to learn a distinction the next click undoes.
     */
    selected: boolean;
    play: FlowNodePlayProps | null;
    menu: FlowNodeMenuProps;
    onOpen: () => void;
    /** <kbd>Ctrl</kbd>-click: this card taken into the marked set, or back out of it. */
    onMark: () => void;
    /** The double-click: the same flow node, in the large editor over the central area. */
    onExpand: () => void;
    onKeyDown: React.KeyboardEventHandler<HTMLElement>;
    /** What the card shows of a drag aimed at it. The drag itself starts anywhere on the card. */
    cardClass: string | undefined;
    dragProps: {
        onPointerDown: React.PointerEventHandler<HTMLElement>;
        onPointerMove: React.PointerEventHandler<HTMLElement>;
        onPointerUp: React.PointerEventHandler<HTMLElement>;
        onPointerCancel: React.PointerEventHandler<HTMLElement>;
        onLostPointerCapture: React.PointerEventHandler<HTMLElement>;
    };
}

/**
 * Whether the press is asking to **mark** the card rather than to open it: <kbd>Ctrl</kbd>, and
 * <kbd>Cmd</kbd> beside it, which is the same gesture on a Mac and the one a Mac hand reaches for.
 */
const marking = (event: { ctrlKey: boolean; metaKey: boolean }): boolean => event.ctrlKey || event.metaKey;

/** What the knob's tooltip says of the transition mode, in as few words as it can. */
export const MODE_NOTE: Record<TransitionMode, string> = {
    continue: 'forked chat',
    end: 'new chat',
};

/**
 * What the knob shows of the way the card ends: not that a chain leaves it — the knob being tied
 * says that — but the **transition mode**, which is the part a gesture cannot say and the part that
 * costs.
 *
 * The third glyph went with the third mode. Whether the card shortens its chat is not drawn here and
 * is not drawn anywhere on the card: it is read where it is set, beside the effort and the
 * permission mode, for the same reason those two are not worn either — a row of marks that all have
 * to be read in full to find the one that changed is a row nobody reads. The knob's tooltip says it,
 * which is what the knob's tooltip is for.
 */
const MODE_GLYPH: Record<TransitionMode, React.ReactNode> = {
    continue: <ArrowRightOutlined />,
    end: <ScissorOutlined />,
};

export const CHAIN_HELP = 'Drag to the next node; drop elsewhere to unchain.';

/** What the knob says on a Gateway: a drawn line adds a branch, and takes none off. */
export const GATEWAY_CHAIN_HELP = 'Drag to a node to add a branch; branches are taken off in the panel.';

/** What the chat mark says of itself. The card is the only place a conversation is reached from
 *  without opening the flow node first, which is what a board being read is doing. */
export const CHAT_HELP = 'Open the conversation this node was played in.';

/** What the card says of a mode nothing on it can honour — the settings naming no turn to play. */
export const BROKEN_NOTE = 'Nothing here can play it.';

/**
 * What the card says of a node that cannot be played as it stands: one mark, and no list of
 * what it is missing — the panel names each field.
 */
export const INVALID_HELP = 'Incomplete — open the node to see what\u2019s missing.';

/**
 * What the bubbles at the foot say of the two cards the board plays to **itself**. They hold no
 * settings, so the row that would name a model and an effort says instead the one thing about each
 * worth finding on a board of forty without opening it: that the card is the machine going off, and
 * the hour the other one is holding for.
 */
const TYPE_CHIPS: Partial<Record<FlowNodeType, (flowNode: FlowNode) => SettingChip[]>> = {
    shutdown: () => [{ text: 'shutdown' }],
    scheduler: flowNode => {
        const when = scheduleLabel(flowNode.at, flowNode.duration);
        // The schedule is the whole of what a Scheduler is run with, so its absence is what a
        // missing setting is on an AI card: the node is incomplete, and no chain passes through
        // it until one is picked.
        return [when ? { text: when } : { text: 'no datetime', missing: true }];
    },
    // The branches the Gateway starts when it fires. Never missing: a Gateway with none still
    // joins what feeds into it.
    gateway: flowNode => {
        const count = flowNode.onSuccess.flowNodes.length;
        return [{ text: count === 0 ? 'no branches' : `${count} branch${count === 1 ? '' : 'es'}` }];
    },
};

/**
 * The BPMN parallel-gateway mark — a plus, and nothing round it. The diamond it sits in is the
 * Gateway's own ring, so a second diamond here would be a diamond inside the diamond. Drawn big:
 * the glyph nearly fills the shape, with a small padding.
 */
export const GatewayGlyph: React.FC<{ size?: number }> = ({ size = 13 }) => (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
        <path d="M 6 1 V 11 M 1 6 H 11" stroke="currentColor" strokeWidth="1.8" />
    </svg>
);

/**
 * What kind of node it is, where a card that is played carries its button — and, on the three the
 * board plays to itself, the glyph that fills the shape.
 *
 * A **Human** card always wears its mark: nobody plays it, the work is somebody's own, and the slot
 * the play button would sit in was empty — so a card a person does looked exactly like an AI card
 * whose settings were half answered, which is the one distinction a board is read for. It says so
 * now, in the place the question *would* have been asked.
 *
 * The other three always wear theirs too: they are never played directly, so the mark is the whole
 * of what the shape says, play or no play — the power mark, the clock and the plus, the Gateway's
 * sized to fill its diamond. An **AI** card is not in this list — one that carries no Play says so
 * at its foot, in the one mark an incomplete node wears.
 */
const TYPE_MARK: Partial<Record<FlowNodeType, React.ReactNode>> = {
    human: <UserOutlined />,
    shutdown: <PoweroffOutlined />,
    scheduler: <FieldTimeOutlined />,
    gateway: <GatewayGlyph size={36} />,
};

/** What the mark says of itself, since it is the whole of what the card says about its kind. */
export const MARK_HELP: Partial<Record<FlowNodeType, string>> = {
    human: 'Somebody does this one by hand',
    shutdown: 'Turns the machine off',
    scheduler: 'Waits for a duration or datetime, then plays the node after it',
    gateway: 'Waits for every branch, then starts each successor',
};

/**
 * The stripe down the card's left edge, one colour per status. It is the only thing a board says
 * about where its flow nodes stand that can be read without reading: a `ready` card names its status
 * nowhere — silence is what waiting to be done says — so on a board of forty cards the colour is
 * the whole of the answer to which ones are still to write, which are held up, which are left,
 * which are being worked on, and which went wrong. `error` alone is loud on all four sides: it is
 * the one card a board read the next morning is read for.
 */
const STATUS_STRIPE: Record<FlowNodeStatus, string> = {
    draft: styles.cardDraft,
    ready: styles.cardReady,
    blocked: styles.cardBlocked,
    running: styles.cardRunning,
    'waiting-refresh': styles.cardWaitingRefresh,
    interrupted: styles.cardInterrupted,
    done: styles.cardDone,
    error: styles.cardFailed,
};

/**
 * The same eight colours as the card's stripe, worn as the symbol's ring: a Shutdown, a Scheduler
 * and a Gateway have no edge to stripe, so the circle or the diamond itself carries the status.
 */
const SYMBOL_RING: Record<FlowNodeStatus, string> = {
    draft: styles.symbolDraft,
    ready: styles.symbolReady,
    blocked: styles.symbolBlocked,
    running: styles.symbolRunning,
    'waiting-refresh': styles.symbolWaitingRefresh,
    interrupted: styles.symbolInterrupted,
    done: styles.symbolDone,
    error: styles.symbolError,
};

/** The same colours where the status is also named, under the title. `ready` is not named there. */
const STATUS_TONE: Record<FlowNodeStatus, string> = {
    draft: styles.cardStateDraft,
    ready: '',
    blocked: styles.cardStateBlocked,
    running: styles.cardStateRunning,
    'waiting-refresh': styles.cardStateWaitingRefresh,
    interrupted: styles.cardStateInterrupted,
    done: styles.cardStateDone,
    error: styles.cardStateBad,
};

/**
 * The glyph before the status, where the card names one. It reads at a glance what the word reads
 * at a look, and it is what a card printed, screenshotted or read in a colour nobody's eyes tell
 * apart still says. None for `ready`, which is named nowhere, and none for `running`: a flow node a play
 * is holding says so with the play's own spinner on the cards of the board being played, and this
 * glyph is what every *other* board says about the same flow node — a plain mark, not an animation
 * pretending to watch something it cannot see.
 */
const STATUS_GLYPH: Record<FlowNodeStatus, React.ReactNode> = {
    draft: <EditOutlined />,
    ready: null,
    blocked: <MinusCircleOutlined />,
    running: <SyncOutlined />,
    'waiting-refresh': <ClockCircleOutlined />,
    interrupted: <PauseCircleOutlined />,
    done: <CheckCircleOutlined />,
    error: <ExclamationCircleOutlined />,
};

/**
 * One flow node: its title, the tags it is filed under, where it stands, and — worn at the foot as the
 * tags are worn — the little its settings still have to say about running it. Clicking it opens the
 * flow node in its panel and double-clicking it opens the same flow node in the large editor over the central
 * area, which is the room a body with sub-headings and tables wants. Right-clicking it clones it,
 * copies it, or deletes it.
 *
 * **Ctrl-clicking it marks it** instead, beside whatever is marked already: the cards a drag or a
 * delete then acts on together. It opens nothing — picking out five cards is not five flow nodes opened
 * in the panel on the way — and a second Ctrl-click takes the card back out.
 *
 * **The description is not on the card at all.** It used to open it — its first three lines, read
 * as the markdown they were written in — and three lines of a specification are three lines that say what every
 * other card on the board says: *Read the following and*. A card is found by its title and its tags,
 * and what is being asked is read where it can be read whole, which is the panel and the large
 * editor. What the card keeps is a title, a filing and a state, which is what fits on one.
 *
 * **What kind of card it is is said in the title line**, where the Play button sits: an AI card
 * plays with a triangle, and a Human card, which nobody plays, carries the same slot as a mark
 * saying the work is somebody's own. See `TYPE_MARK`.
 *
 * **The card body itself opens the flow node — and, held and pulled, moves it** (`useSpotDrag`):
 * a mouse press anywhere on it is the start of a drag, and one that does not travel is the click
 * that opens. The knob at the bottom right draws a chain from the card to another card
 * (`useLinkDrag`), and the card's own controls — the Play, the chat mark, the unlink — keep the
 * presses meant for them: a press that might turn out to be any of three things four pixels later
 * is a press nobody can aim.
 *
 * The button in the title line — an AI card's alone — plays this flow node and the chain it
 * starts, and is the play's **Stop** while that runs. It swallows the events it answers: the card
 * underneath it opens flow nodes, and a press meant for the button is not that.
 *
 * A flow node that names another after it says so at the knob and nowhere else: named on the card, the
 * flow node after it costs a line of every card on the board, which is room the board has not got. The
 * knob carries the **transition mode**'s glyph and its tooltip names the flow node and what the mode
 * does. It is empty for a card that ends where it is with nothing to say about it, which is most of them.
 *
 * **Left of the knob is the chat mark**, on a card whose flow node has been played: it opens the
 * conversation in the Claude panel. A board is mostly read rather than edited, and what a played
 * flow node actually did is in its chat — reaching it used to mean opening the flow node in its panel first,
 * which is two gestures and a panel nobody wanted, for the one thing a finished card is worth
 * following. It is absent where there is no chat to open, which is every flow node not yet played.
 *
 * **A Shutdown card carries no knob at all**: nothing is ever played once the machine is off, so
 * there is no chain to draw from it and no gesture to offer. What it is says itself in the bubble at
 * its foot, where a played card wears its agent — and so does a **Scheduler**'s datetime, which is
 * the one thing about that card worth finding on a board of forty without opening one.
 *
 * **The three the board plays to itself are not cards.** A Shutdown and a Scheduler are drawn as a
 * BPMN event's circle, a Gateway as a BPMN gateway's diamond, with the label under the shape — the
 * same title, tags, state and bubbles a card wears, centred. The shape is no button: it carries the
 * kind mark, and the node opens, drags and right-clicks exactly the way a card does — a click is the
 * panel, a double-click the large editor. It wears the status as its ring, the colour a card wears
 * as its stripe, and the chain knob sits at the shape's right edge.
 */
export const FlowNodeCard: React.FC<FlowNodeCardProps> = ({
    flowNode, next, chain, selected, play, menu, onOpen, onMark, onExpand, onKeyDown, onOpenChat,
    onUnlinkClass, cardClass, dragProps,
}) => {
    // The chips are whatever plugin owns the store's tags; in an assembly without one they draw
    // nothing, and a card simply wears no colours.
    const { TagChips } = useTagsUi();
    // The agents, for the name the settings chip wears: a card names its agent by id, and the foot
    // of it shows the name. Where the list is not there — a tree that mounted no provider — the
    // card wears what the settings say instead of throwing for it.
    const { agents } = useAgents();
    const state = play?.state ?? 'idle';
    const running = state !== 'idle';
    const playing = state === 'playing';
    const mode = flowNode.onSuccess.mode;
    const broken = brokenTransition(flowNode.onSuccess, flowNode.settings);
    // What the foot of the card wears is what the type has to say: an AI card the agent its turn
    // runs on, the two the board plays to itself what they are, and a Human card nothing — a card
    // somebody does by hand is its title and its tags. A card still missing any of it wears no
    // list: one mark says it cannot be played as it stands, and the panel names each field.
    const chips = flowNode.type === 'ai'
        ? settingsChips(flowNode.settings, agents)
        : TYPE_CHIPS[flowNode.type]?.(flowNode) ?? [];
    /** Whether the node cannot be played as it stands: any setting — or the Scheduler's datetime — still missing. */
    const invalid = chips.some(chip => chip.missing);

    /**
     * What the card hands on to and what it leaves behind, as the knob's tooltip reads it out. The
     * compaction is said whether or not a chain leaves the card: it is what becomes of this card's
     * own chat, and the last card of a chain says it as loudly as the first. A Gateway names its
     * branches, each by title, with no transition mode — it hands on no chat.
     */
    const chainNote = [
        next ? (flowNode.type === 'gateway'
            ? `Branches: ${next.title}.`
            : `Next: “${next.title || 'Untitled'}” · ${MODE_NOTE[mode]}.`) : '',
        flowNode.onSuccess.compact ? 'Chat shortened.' : '',
    ].filter(Boolean).join(' ');

    /** The knob's whole tooltip: what this card hands on to, what is wrong with it, and the gesture. */
    const knobTitle = [
        chainNote, broken ? BROKEN_NOTE : '',
        flowNode.type === 'gateway' ? GATEWAY_CHAIN_HELP : CHAIN_HELP,
    ].filter(Boolean).join(' ');

    // Which chain run the Stop would end. Several play at once, so a button that said only
    // "stop the play" would name none of them; an idle card names nothing and reads as it always
    // did.
    const runNote = play?.chainRun ? ` (${play.chainRun})` : '';

    const playLabel = state === 'waiting'
        ? `Claude could not take this node; it is played again at ${retryClock(play?.retryAt ?? Date.now())}`
        : state === 'refreshing'
            ? 'Claude\u2019s usage limit was reached; this node\u2019s turn is picked back up at '
                + `${retryClock(play?.retryAt ?? Date.now())} — stop the play${runNote}`
            : state === 'compacting' ? `This node’s chat is being shortened — stop the play${runNote}`
                : state === 'scheduled' ? `Holding for this card\u2019s schedule — stop the play${runNote}`
                    : state === 'stopping' ? 'Finishing the node under way…'
                        : state === 'playing' ? `Claude is on this node — stop after it${runNote}`
                            : 'Play this node and what follows it';

    // Who the agent bubble names while the card is being played: the agent running this card, by
    // the name the store keeps for the id — the same name the foot of a settled card wears. A
    // card from before managed agents wears its model there, and so does this chip; where neither
    // names anything it reads as it always did. Doubled as the fallback chip where a card being
    // played wears no bubble to hang the progress mark on.
    const runner = agents.find(agent => agent.id === flowNode.settings.agent)?.name
        ?? flowNode.settings.model
        ?? 'Claude';

    /**
     * The bubbles a card being played wears: the agent alone, with the progress mark — an AI card
     * names its agent, the two the board plays to itself what they are. The half-answered list a
     * settled card wears is yesterday's news mid-play, like its status line.
     */
    const playChips: SettingChip[] = flowNode.type === 'ai' || chips.length === 0
        ? [{ text: runner }]
        : chips;

    /**
     * The one line the card gives to where things stand: the play while it runs, the status after.
     * A card being played gives no line: the agent bubble at its foot carries the progress mark
     * instead, so the card spares the row the "{agent} is on it…" sentence used to take.
     */
    const note = state === 'waiting' ? `Played again at ${retryClock(play?.retryAt ?? Date.now())}`
        : state === 'refreshing'
            ? `${STATUS_LABELS[WAITING_REFRESH]} · back at ${retryClock(play?.retryAt ?? Date.now())}`
            : state === 'compacting' ? 'Shortening its chat…'
                : state === 'scheduled' ? 'Waiting for the schedule…'
                    : state === 'stopping' ? 'Stopping after this node…'
                        : state === 'playing' ? ''
                            : flowNode.status === READY ? '' : STATUS_LABELS[flowNode.status];

    // What shape the node is drawn as: a card for the two kinds of work, a BPMN circle or diamond
    // for the three the board plays to itself.
    const kind = symbolKindOf(flowNode.type);

    /** What the Play is called in the tests. */
    const playTestId = state === 'waiting' ? 'flow-node-card-waiting'
        : state === 'refreshing' ? 'flow-node-card-refreshing'
            : state === 'compacting' ? 'flow-node-card-compacting'
                : state === 'scheduled' ? 'flow-node-card-scheduled'
                    : state === 'stopping' ? 'flow-node-card-stopping'
                    : state === 'playing' ? 'flow-node-card-playing'
                        : 'play-flow-node';

    /** What the Play shows: the triangle, or the Stop and the waits while a run holds the card. */
    const playIcon = state === 'stopping' ? <LoadingOutlined />
        : state === 'waiting' || state === 'refreshing'
            ? <ClockCircleOutlined />
            : running ? <StopOutlined />
                : <PlayCircleOutlined />;

    /**
     * Tasks show their control beside the title; Schedulers show it beside the clock.
     */
    const control = running ? play?.onStop : play?.onPlay;

    const playButton = control && (
        <Tooltip title={playLabel}>
            <button
                type="button"
                className={styles.cardPlay}
                aria-label={playLabel}
                data-testid={playTestId}
                disabled={state === 'stopping'}
                onKeyDown={event => event.stopPropagation()}
                onPointerDown={event => event.stopPropagation()}
                onClick={event => { event.stopPropagation(); control(); }}
            >
                {playIcon}
            </button>
        </Tooltip>
    );

    /** What a symbol says it is, play or no play: the kind mark. */
    const symbolMark = TYPE_MARK[flowNode.type];

    /** The tags' row: left under a title, centred under a shape. */
    const tagsClass = kind === 'rect' ? styles.cardTags : styles.symbolTags;

    /**
     * Everything under the title: the tags the node is filed under, the class it was made from,
     * where it stands, and what it is run with. The card's rows and the symbol's label are the
     * same rows — a symbol says everything a card says, only centred under its shape.
     */
    const foot = (
        <>
            <TagChips labels={flowNode.tags} className={tagsClass} />
            {flowNode.classVersion && (
                <div className={styles.cardClassRef} data-testid="flow-node-class-ref">
                    <ClusterOutlined />
                    <span>
                        {flowNode.classVersion.classTitle || 'Untitled'}
                        {' · '}
                        v{flowNode.classVersion.versionNumber}
                    </span>
                    {onUnlinkClass && (
                        <Tooltip title="Break the link to the class — the node keeps what it says">
                            <button
                                type="button"
                                className={styles.cardClassUnlink}
                                aria-label="Break the link to the class"
                                data-testid="unlink-flow-node-class"
                                onKeyDown={event => event.stopPropagation()}
                                onPointerDown={event => event.stopPropagation()}
                                onClick={event => {
                                    event.stopPropagation();
                                    onUnlinkClass();
                                }}
                            >
                                <DisconnectOutlined />
                            </button>
                        </Tooltip>
                    )}
                </div>
            )}
            {note && (
                <div
                    className={`${styles.cardState} ${running ? '' : STATUS_TONE[flowNode.status]}`}
                    data-testid="flow-node-card-state"
                >
                    {!running && STATUS_GLYPH[flowNode.status]}
                    {note}
                </div>
            )}
            {playing ? (
                <div className={styles.cardChips} data-testid="flow-node-card-settings">
                    {playChips.map((chip, slot) => (
                        <span
                            // Keyed on where it is: the row is a fixed set of questions in
                            // a fixed order, and two of them may well be answered the same
                            // word — a model called `max` beside an effort called `max`.
                            key={slot}
                            className={`${styles.cardChip} ${chip.missing ? styles.cardChipMissing : ''}`}
                            data-testid="flow-node-card-chip"
                        >
                            {slot === 0 && (
                                <span
                                    className={styles.cardChipSpin}
                                    role="img"
                                    aria-label="In progress"
                                    data-testid="flow-node-card-running-icon"
                                >
                                    <SyncOutlined spin />
                                </span>
                            )}
                            {chip.text}
                        </span>
                    ))}
                </div>
            ) : invalid ? (
                <Tooltip title={INVALID_HELP}>
                    <span
                        className={styles.cardInvalid}
                        role="img"
                        aria-label={INVALID_HELP}
                        data-testid="flow-node-card-invalid"
                    >
                        <ExclamationCircleOutlined />
                    </span>
                </Tooltip>
            ) : chips.length > 0 ? (
                <div className={styles.cardChips} data-testid="flow-node-card-settings">
                    {chips.map((chip, slot) => (
                        <span
                            // Keyed on where it is: the row is a fixed set of questions in
                            // a fixed order, and two of them may well be answered the same
                            // word — a model called `max` beside an effort called `max`.
                            key={slot}
                            className={`${styles.cardChip} ${chip.missing ? styles.cardChipMissing : ''}`}
                            data-testid="flow-node-card-chip"
                        >
                            {chip.text}
                        </span>
                    ))}
                </div>
            ) : null}
        </>
    );

    const items: MenuProps['items'] = [
        // First: the copy nobody needs the clipboard for. Copy is for carrying a flow node to
        // another board — this is the one wanted on the board already open.
        { key: 'clone', icon: <BlockOutlined />, label: 'Clone node', onClick: menu.onClone },
        // Beside the Clone, which is the other way of making more of a card: this one files the
        // reusable shape rather than a second card. A task's alone.
        ...(menu.onConvertToClass && isTask(flowNode.type) ? [{
            key: 'convert',
            icon: <ClusterOutlined />,
            label: 'Convert to class',
            onClick: menu.onConvertToClass,
        }] : []),
        // Beside the Clone and the Convert, which are the other ways of making more of a card:
        // this one files the rectangle round the marked set, from one card up.
        ...((menu.onCreateWorkflow && (menu.creating ?? 0) > 0) ? [{
            key: 'create-workflow',
            icon: <GroupOutlined />,
            label: (menu.creating ?? 0) > 1 ? `Create workflow (${menu.creating} nodes)` : 'Create workflow (1 node)',
            onClick: menu.onCreateWorkflow,
        }] : []),
        { type: 'divider' },
        {
            key: 'copy',
            icon: <CopyOutlined />,
            label: menu.copying > 1 ? `Copy ${menu.copying} nodes` : 'Copy node',
            onClick: menu.onCopy,
        },
        // After the Copy rather than before it, where a menu bar would have it: the two write the
        // same clipboard, and this is the one that takes the cards off the board. The order
        // says which is which.
        {
            key: 'cut',
            icon: <ScissorOutlined />,
            label: menu.cutting > 1 ? `Cut ${menu.cutting} nodes` : 'Cut node',
            onClick: menu.onCut,
        },
        // After the Cut, which is the other way of carrying cards to another board: this one
        // files them there directly, through the service, rather than through the clipboard.
        // The count reads the way the Copy's does, for the same reason — the submenu names the
        // board, and the item names how many cards are going.
        {
            key: 'move',
            icon: <ExportOutlined />,
            label: (menu.moving ?? menu.cutting) > 1
                ? `Move ${menu.moving ?? menu.cutting} nodes to...`
                : 'Move to...',
            children: (menu.moveTargets ?? []).length > 0
                ? (menu.moveTargets ?? []).map(target => ({
                    key: `move-${target.slug}`,
                    label: <span data-testid={`move-to-${target.slug}`}>{target.name}</span>,
                    onClick: () => menu.onMove?.(target.slug),
                }))
                : [{ key: 'move-none', label: 'No other boards', disabled: true }],
        },
        { type: 'divider' },
        // The two ways off the board, in the order they are wanted: the card kept as a file, and
        // the card thrown away.
        { key: 'archive', icon: <InboxOutlined />, label: 'Archive node', onClick: menu.onArchive },
        {
            key: 'delete',
            icon: <DeleteOutlined />,
            label: menu.deleting > 1 ? `Delete ${menu.deleting} nodes` : 'Delete node',
            danger: true,
            onClick: menu.onDelete,
        },
    ];

    /**
     * The way into the conversation the node was played in: a card's corner, or a symbol's shape
     * edge. A symbol carries it only as a retyped card keeping its conversation — the three speak
     * to nobody.
     */
    const chatMark = onOpenChat && (
        <Tooltip title={CHAT_HELP}>
            <button
                type="button"
                className={kind === 'rect' ? styles.cardChat : styles.symbolChat}
                aria-label="Open the node’s chat"
                data-testid="flow-node-card-chat"
                onKeyDown={event => event.stopPropagation()}
                // The card underneath starts a move, and a press meant for
                // this is not that.
                onPointerDown={event => event.stopPropagation()}
                // The card underneath opens the flow node in its panel, and a press
                // meant for this is not that — nor is it the double-click that
                // would open the large editor over the chat just asked for.
                onDoubleClick={event => event.stopPropagation()}
                onClick={event => {
                    event.stopPropagation();
                    onOpenChat();
                }}
            >
                <MessageOutlined />
            </button>
        </Tooltip>
    );

    /**
     * The knob a chain is drawn from. At the card's bottom-right corner, or at the symbol's shape
     * edge — the same handle and the same tooltip, only the seat differs.
     */
    const knob = chain && (
        <span
            {...chain.knobProps}
            // The card underneath starts a move, and a press meant for
            // the knob draws a chain instead.
            onPointerDown={event => {
                chain.knobProps.onPointerDown(event);
                event.stopPropagation();
            }}
            className={[
                styles.chainKnob,
                kind === 'rect' ? '' : styles.symbolKnob,
                next ? styles.chainKnobTied : '',
                broken ? styles.chainKnobBroken : '',
                chain.source ? styles.chainKnobDrawing : '',
            ].filter(Boolean).join(' ')}
            role="presentation"
            // The chain is drawn on the board itself; the knob is the way a
            // pointer draws one, and a second reading of the same thing.
            aria-hidden="true"
            // The browser's own tooltip rather than the app's: an antd one is a box
            // in the document, and what a chain lands on is whatever the document
            // says is under the pointer — including a tooltip left open by the very
            // press that started the drag.
            title={knobTitle}
            data-testid="flow-node-card-chain"
            data-mode={next ? mode : undefined}
            data-compact={flowNode.onSuccess.compact ? 'true' : undefined}
            data-broken={broken ? 'true' : undefined}
            // The card underneath opens flow nodes; a click meant for the knob is not that.
            onClick={event => event.stopPropagation()}
            onDoubleClick={event => event.stopPropagation()}
        >
            {next && flowNode.type !== 'gateway' && MODE_GLYPH[mode]}
        </span>
    );

    // The three the board plays to itself: a BPMN circle or diamond with the label under it. The
    // shape carries the kind mark, the ring is the status, and the rows under it are the card's
    // own. The node opens, drags and right-clicks exactly the way a card does.
    if (kind !== 'rect') {
        const circle = kind === 'event';
        const shapeClass = [
            circle ? styles.symbolEvent : styles.symbolGateway,
            circle && flowNode.type === 'shutdown' ? styles.symbolEventEnd : '',
        ].filter(Boolean).join(' ');
        return (
            // The node's menu and the canvas's are two menus on nested elements, and a right-click
            // is one gesture: the node answers it and the canvas must not answer it again.
            <div onContextMenu={event => event.stopPropagation()}>
                <Dropdown menu={{ items }} trigger={['contextMenu']} {...KEEP_MENU_IN_VIEWPORT}>
                    <div
                        className={[
                            styles.symbol,
                            selected ? styles.symbolSelected : '',
                            SYMBOL_RING[flowNode.status],
                            running ? styles.symbolPlaying : '',
                            chain?.target ? styles.symbolChainTarget : '',
                            cardClass ?? '',
                        ].filter(Boolean).join(' ')}
                        role="button"
                        tabIndex={0}
                        data-testid="flow-node-card"
                        data-status={flowNode.status}
                        data-shape={circle ? 'circle' : 'diamond'}
                        // What a chain being drawn lands on is read off the document: the node
                        // under the pointer is the node that says which flow node it is.
                        {...{ [FLOW_NODE_ID_ATTRIBUTE]: flowNode.id }}
                        // The whole symbol is the drag's handle, the way the whole card is: a
                        // mouse press anywhere on it starts a move — the shape included — and the
                        // controls below keep the presses meant for them.
                        {...dragProps}
                        // Held down, Ctrl — Cmd where that is the key — makes the click a **mark**
                        // rather than an opening, the way it does on a card.
                        onClick={event => (marking(event) ? onMark() : onOpen())}
                        // The first click of it has already selected the flow node, which is the one the
                        // large editor is then handed. The panel that click asked for is the board's
                        // to hold back — see `openFlowNode`.
                        onDoubleClick={event => { if (!marking(event)) onExpand(); }}
                        onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                if (marking(event)) onMark();
                                else onOpen();
                                return;
                            }
                            onKeyDown(event);
                        }}
                    >
                        <div className={circle ? styles.symbolEventWrap : styles.symbolGatewayWrap}>
                            {symbolMark && (
                                <Tooltip title={MARK_HELP[flowNode.type]}>
                                    <div
                                        className={shapeClass}
                                        role="img"
                                        aria-label={MARK_HELP[flowNode.type]}
                                        data-testid="flow-node-card-kind"
                                        data-type={flowNode.type}
                                    >
                                        {circle ? symbolMark : (
                                            <span className={styles.symbolGatewayInner}>
                                                {symbolMark}
                                            </span>
                                        )}
                                    </div>
                                </Tooltip>
                            )}
                            {flowNode.type === 'scheduler' && playButton && (
                                <div className={styles.symbolPlay}>{playButton}</div>
                            )}
                            {chatMark}
                            {knob}
                        </div>
                        <div className={styles.symbolLabel}>
                            {flowNode.type !== 'scheduler' && (
                                <div className={styles.symbolTitle}>{flowNode.title || 'Untitled'}</div>
                            )}
                            {foot}
                        </div>
                    </div>
                </Dropdown>
            </div>
        );
    }

    return (
        // The card's menu and the canvas's are two menus on nested elements, and a right-click is
        // one gesture: the card answers it and the canvas must not answer it again.
        <div onContextMenu={event => event.stopPropagation()}>
            <Dropdown menu={{ items }} trigger={['contextMenu']} {...KEEP_MENU_IN_VIEWPORT}>
                <div
                    className={[
                        styles.card,
                        selected ? styles.cardSelected : '',
                        STATUS_STRIPE[flowNode.status],
                        // The bottom-right gutter holds two marks instead of one, and the card's
                        // own lines are what would otherwise run under the second.
                        onOpenChat ? styles.cardChatted : '',
                        running ? styles.cardPlaying : '',
                        chain?.target ? styles.cardChainTarget : '',
                        cardClass ?? '',
                    ].filter(Boolean).join(' ')}
                    role="button"
                    tabIndex={0}
                    data-testid="flow-node-card"
                    data-status={flowNode.status}
                    // What a chain being drawn lands on is read off the document: the card under
                    // the pointer is the card that says which flow node it is. See `useLinkDrag`.
                    {...{ [FLOW_NODE_ID_ATTRIBUTE]: flowNode.id }}
                    // The whole card is the drag's handle: a mouse press anywhere on it starts
                    // a move, and the controls below keep the presses meant for them.
                    {...dragProps}
                    // Held down, Ctrl — Cmd where that is the key — makes the click a **mark**
                    // rather than an opening: the card joins the ones the next move or delete is
                    // about, and nothing is opened, because picking out five cards must not be five
                    // flow nodes opened in the panel on the way.
                    onClick={event => (marking(event) ? onMark() : onOpen())}
                    // The first click of it has already selected the flow node, which is the one the
                    // large editor is then handed: the two openings are one flow node's. The panel that
                    // click asked for is the board's to hold back — see `openFlowNode`.
                    onDoubleClick={event => { if (!marking(event)) onExpand(); }}
                    onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            if (marking(event)) onMark();
                            else onOpen();
                            return;
                        }
                        onKeyDown(event);
                    }}
                >
                    <div className={styles.cardTitle}>
                        {playButton}
                        {/* Where a card that is played would carry its button, one that is not
                            carries what it is. See `TYPE_MARK`. */}
                        {!control && TYPE_MARK[flowNode.type] && (
                            <Tooltip title={MARK_HELP[flowNode.type]}>
                                <span
                                    className={styles.cardKind}
                                    role="img"
                                    aria-label={MARK_HELP[flowNode.type]}
                                    data-testid="flow-node-card-kind"
                                    data-type={flowNode.type}
                                >
                                    {TYPE_MARK[flowNode.type]}
                                </span>
                            </Tooltip>
                        )}
                        {flowNode.title || 'Untitled'}
                    </div>
                    {foot}
                    {chatMark}
                    {knob}
                </div>
            </Dropdown>
        </div>
    );
};
