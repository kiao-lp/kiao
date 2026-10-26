import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import * as ops from './boardOps';
import * as writes from './boardWrites';
import { useBoardSync } from './useBoardSync';
import { ClassVersionEdit, FlowNodeClassEdit, FlowNodeEdit } from './boardOps';
import { FlowNodeClass, FlowNodeClassVersion, newFlowNodeClass } from './flowNodeClass';
import { InstantiateBodies } from './service';
import { FlowNodeSpot } from './flowNodeSpot';
import { FlowNodeStatus } from './flowNodeStatus';
import { newFlowNodeSettings, FlowNodeType } from './flowNodeType';
import { usePlayDefaults } from './usePlayDefaults';
import {
    newFlowNode, newId, BoardContent, FlowNode, Workflow, WorkflowClass,
} from './boardContent';

/** A workflow or workflow class open in the workflow panel, by kind and id. */
export interface SelectedWorkflow {
    kind: 'workflow' | 'workflowClass';
    id: string;
}

interface HybridflowValue {
    /** The board being shown — null while it is being read, and for a handle that holds none. */
    content: BoardContent | null;
    /**
     * The **handle** of the open board — its slug — or null when none is open. It is what a play is
     * started on: the run is worker's, and it names the board it plays by the same handle.
     * It is what names a board everywhere a board is named: in the URL, in a link somebody
     * pasted, and on the wire to the run.
     */
    handle: string | null;
    /** What went wrong, worded by the service, or null when nothing has. */
    error: string | null;
    loading: boolean;
    /** The flow node open in the flow node panel, by id. */
    selected: string | null;
    select: (flowNodeId: string | null) => void;
    /**
     * The cards **marked** on the board, by id: the ones a delete aimed at any of them
     * acts on. Empty is the ordinary case — one card, or none — and only <kbd>Ctrl</kbd>-click
     * fills it. It is not the same thing as {@link selected}, which is the one flow node the panel is
     * editing: a mark is what the *next gesture* is about, an opening is what the editor is about,
     * and marking a second card must not throw away the box somebody is typing in.
     */
    marked: string[];
    /**
     * Takes a card in or out of the marked set — the whole of what <kbd>Ctrl</kbd>-click does. The
     * first one starts the set from the flow node already open, since marking a *second* card is what
     * the gesture plainly means.
     */
    toggleMark: (flowNodeId: string) => void;
    clearMarks: () => void;
    /**
     * Picks out exactly these cards — what the box drawn on the canvas writes, live, as it
     * moves. A whole replacement, like every other write of a set on this board: the caller
     * says which cards are picked out, and the board holds those and no others.
     */
    setMarked: (flowNodeIds: string[]) => void;
    /**
     * How many flow nodes have been opened. Counted rather than compared, because opening the flow node
     * is already open is a thing that happens — a template applied, a flow node recreated — and the
     * panel reloads its editor on this.
     */
    openingId: number;
    /** The open flow node, or null when nothing is open. */
    selectedFlowNode: ops.FlowNodeAt | null;
    /** The open node class, or null when the opening is a flow node or nothing at all. */
    selectedClass: ops.FlowNodeClassAt | null;
    /** The workflow or workflow class open in the workflow panel, by kind and id. */
    selectedWorkflow: SelectedWorkflow | null;
    selectWorkflow: (workflow: SelectedWorkflow | null) => void;
    /** The open workflow or workflow class, or null when the opening is a card or nothing. */
    selectedWorkflowGroup: Workflow | WorkflowClass | null;
    /**
     * Whether the open flow node is also open in the large editor over the central area. It is held
     * here rather than in the panel because both open it: the panel's expand button, and a
     * double-click on the card — the board and the panel are two views of one open flow node.
     */
    expanded: boolean;
    setExpanded: (open: boolean) => void;
    /** Points the board at a handle. Cheap to call on every render. */
    openBoard: (handle: string) => void;
    /**
     * Looks at the board now rather than waiting for the watch to come round. What a board
     * does when the play says it has written it: a run marks flow nodes in the very
     * board the user may have open, and there is no reason for the card to be two seconds behind.
     *
     * Nothing is lost either way. What arrives is merged with what is on screen, never written over
     * it — see the provider, and [boardMerge.ts](./boardMerge.ts).
     */
    reloadBoard: () => void;
    /** The board's view is going away: what it holds is dropped, landing what it owes first. */
    closeBoard: () => void;

    /**
     * Chains a flow node to another, or takes the chain off with a null target — what a chain drawn
     * from card to card on the board writes. See `boardOps.chainFlowNode` for what it makes of a chain
     * that is already there.
     */
    chainFlowNode: (fromId: string, toId: string | null) => void;
    /**
     * Writes where cards sit on the board, in one edit however many are
     * named. What the view writes when it places the cards that have never been placed.
     * Cards and classes alike: a spot is a spot whichever kind of card it puts down.
     */
    placeFlowNodes: (spots: Map<string, FlowNodeSpot>) => void;
    /**
     * Moves cards across the canvas by a distance — what a card dragged there writes, and
     * what a marked set dragged by one of them writes for all of them. See `boardOps.moveSpots`.
     * Cards and classes alike.
     */
    moveSpots: (flowNodeIds: string[], dx: number, dy: number) => void;
    /** Chains a class to another — what a chain drawn from class card to class card writes. */
    chainFlowNodeClass: (fromId: string, toId: string | null) => void;
    /**
     * Says where a flow node stands, from the panel: `ready`, `done` or `error`. A play writes the same
     * field, but it writes it in worker — this is the one place a person does.
     */
    setFlowNodeStatus: (flowNodeId: string, status: FlowNodeStatus) => void;
    /**
     * Makes a card of a **named kind at a point** on the canvas, and opens it — what the canvas's
     * own menu does, there being no box on a canvas to type a title into.
     *
     * What it is given is the place it was asked for, so it is drawn under the pointer that made it
     * rather than wherever an unplaced card would have landed.
     *
     * It arrives **untitled**: a card from the menu is a kind somebody picked. The panel
     * it opens is where it is named.
     */
    addFlowNode: (type: FlowNodeType, spot: FlowNodeSpot, workflow?: string) => void;
    editFlowNode: (flowNodeId: string, edit: FlowNodeEdit) => void;
    removeFlowNode: (flowNodeId: string) => void;
    /** Takes several cards off the board in one edit — what a delete aimed at a marked card does. */
    removeFlowNodes: (flowNodeIds: string[]) => void;
    /** Hides cards everywhere by flipping the boolean, without deleting them. */
    archiveFlowNodes: (flowNodeIds: string[]) => void;
    /** Puts archived cards back on the shown board. Stored for the API; the board draws none. */
    unarchiveFlowNodes: (flowNodeIds: string[]) => void;
    /**
     * Files a copy of a class directly under it, and opens the copy: the class card's own Clone.
     * The copy holds only the latest version of the original, as a draft — see
     * `boardOps.cloneFlowNodeClass`.
     */
    cloneFlowNodeClass: (classId: string) => void;
    /**
     * Files flow nodes onto the board in one edit: what a paste does, however many cards the
     * clipboard held. The **first** of them is opened: a paste of one card is that card, and a
     * paste of six is the head of the block, which is where the eye is already.
     */
    insertFlowNodes: (flowNodes: FlowNode[]) => void;
    /**
     * Files a copy of a flow node directly under it, and opens the copy: the card's own Clone. An id of
     * its own and a chat of its own, and it hands on to whatever the card it was made from hands on
     * to — see `boardOps.cloneFlowNode`.
     */
    cloneFlowNode: (flowNodeId: string) => void;
    /**
     * Makes a class of a **named kind at a point** on the canvas, and opens it — what the
     * canvas's own menu does. It arrives **untitled**, and the panel it opens is where it is
     * named; the title box takes the focus, as a card made on the canvas asks for.
     */
    addFlowNodeClass: (type: FlowNodeType, spot: FlowNodeSpot, workflowClass?: string) => void;
    editFlowNodeClass: (classId: string, edit: FlowNodeClassEdit) => void;
    /** Takes several classes off the board in one edit. */
    removeFlowNodeClasses: (classIds: string[]) => void;
    /**
     * Files the next version under its class — a draft, copied from the version named, or blank
     * where none is. The board is read again once it lands: the version's id is the service's
     * to mint, so there is nothing optimistic to draw meanwhile.
     */
    createClassVersion: (classId: string, from?: FlowNodeClassVersion) => void;
    editClassVersion: (classId: string, versionId: string, edit: ClassVersionEdit) => void;
    /** Publishes a draft: what it says is what stays said. */
    publishClassVersion: (classId: string, versionId: string) => void;
    /** Removes a draft: a new version somebody changed their mind about. */
    deleteClassVersion: (classId: string, versionId: string) => void;
    /**
     * Files a class from a task — what the card's own Convert does. The board is read again
     * once it lands: the class's id is the service's to mint.
     */
    convertFlowNodeToClass: (flowNodeId: string) => void;
    /**
     * Makes flow nodes from a class and all its successors, on this board — what the
     * canvas's Instantiate menu does. Where `bodies` names a class, its flow node is asked
     * the instantiated text rather than its version's body. The board is read again once
     * they land.
     */
    instantiateFlowNodeClass: (
        classId: string, spot: FlowNodeSpot, bodies?: InstantiateBodies, workflow?: string,
    ) => void;
    /**
     * Makes a workflow from a workflow class — one flow node per member — on this board,
     * what the canvas's Instantiate menu does. Where `bodies` names a class, its flow node
     * is asked the instantiated text rather than its version's body. The board is read
     * again once they land.
     */
    instantiateWorkflowClass: (
        workflowClassId: string, spot: FlowNodeSpot, bodies?: InstantiateBodies,
    ) => void;
    /**
     * Files a workflow round these cards, and opens it — what the card menu's Create does.
     * The rectangle arrives unnamed, and the panel it opens is where it is named.
     */
    createWorkflow: (flowNodeIds: string[]) => void;
    /** Files a workflow class round these classes, and opens it. */
    createWorkflowClass: (classIds: string[]) => void;
    /** Renames a workflow. Its members are untouched. */
    editWorkflow: (workflowId: string, name: string) => void;
    /** Renames a workflow class. Its members are untouched. */
    editWorkflowClass: (workflowId: string, name: string) => void;
    /** Takes workflows off the board. Their cards are ungrouped and left where they are. */
    removeWorkflows: (workflowIds: string[]) => void;
    /** Takes workflow classes off the board. */
    removeWorkflowClasses: (workflowIds: string[]) => void;
    /**
     * The flow node whose **title** box is to take the focus as soon as it is on screen. What a card
     * made on the canvas asks for: the menu picked a kind rather than a title, so the
     * card arrives untitled and the panel it opens is where it is named.
     *
     * It waits on the board because the two are not in the same place at the same time: a card made
     * on the canvas opens a panel that is a tool-bar tab and may not even be mounted yet. So the
     * wish is put on the board — the one thing both ends can see — and the panel honours it when it
     * arrives.
     */
    titleCaret: string | null;
    /** The panel saying it has taken it: the focus is placed once, not on every render. */
    takeTitleCaret: () => void;
}

const HybridflowContext = createContext<HybridflowValue | null>(null);

export const useHybridflow = (): HybridflowValue => {
    const context = useContext(HybridflowContext);
    if (!context) throw new Error('useHybridflow must be used within a HybridflowProvider');
    return context;
};

/**
 * The board's state: the content being looked at, the flow node open in the flow node panel, and
 * the writes back to the store.
 *
 * It is mounted for the life of the application, not the life of a view. The panel that edits a
 * flow node lives in a tool bar, which every plugin main view brings up anew — a board-owned state
 * would be torn down between the card and the panel that edits it.
 *
 * **The board is followed rather than owned.** A board is written from both ends at once — a
 * run marks its cards, a Claude turn holding the `hybridflow` skill rewrites it — so the service is
 * watched while a board is open and what arrives is merged with what is on
 * screen ([boardMerge.ts](./boardMerge.ts)) instead of being written over. That is what makes
 * starting a play and writing the next ticket two things that can happen at once.
 */
export const HybridflowProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const [handle, setHandle] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [selectedWorkflow, setSelectedWorkflow] = useState<SelectedWorkflow | null>(null);
    const [marked, setMarked] = useState<string[]>([]);
    const [openingId, setOpeningId] = useState(0);
    const [expanded, setExpanded] = useState(false);
    const [titleCaret, setTitleCaret] = useState<string | null>(null);
    // What a card made on the canvas is made with: the deployment's answers, read once for the
    // board rather than once per card.
    const playDefaults = usePlayDefaults();

    // The board, kept in step with the service: read once, watched after, and merged rather than
    // replaced when it is read again (see useBoardSync). What `apply` takes is the pure operation
    // that changes what is drawn and the call that makes it true — the two given together, because
    // working the second out of the first is the diffing this whole move exists to get away from.
    const { content, loading, error, apply: applyTo, reload } = useBoardSync(handle);

    /**
     * Opens a flow node — a click on a card, or a flow node just created. Moves do not go through this: a
     * flow node that travelled is the same flow node, still open, and the panel has a caret in it that a
     * reload would throw away.
     *
     * The large editor closes on it, and the opening that wants it says so afterwards: it is an
     * editor of the flow node it was opened on, so another flow node arriving in the panel is another flow node.
     */
    const select = useCallback((flowNodeId: string | null) => {
        setSelected(flowNodeId);
        setSelectedWorkflow(null);
        setOpeningId(id => id + 1);
        setExpanded(false);
        // A wish to write in a flow node nobody is opening any more is a focus that would land in
        // somebody else's box; every opening drops it, and the one that wants it asks after.
        setTitleCaret(null);
        // An opening is a selection of one: a plain click on a card says the several cards picked
        // out before it are not what the next gesture is about any more.
        setMarked([]);
    }, []);

    /**
     * Opens a workflow — a click on a rectangle outside any card. The card opening goes with
     * it: the board edits one thing at a time, and the workflow panel is not the card's.
     */
    const selectWorkflow = useCallback((workflow: SelectedWorkflow | null) => {
        setSelectedWorkflow(workflow);
        setSelected(null);
        setExpanded(false);
        setTitleCaret(null);
        setMarked([]);
    }, []);

    /**
     * Ctrl-click. The set starts from the flow node already open — marking a second card means the two
     * of them — and a card marked twice is a card taken back out, which is the way out of a mark
     * made by mistake.
     */
    const toggleMark = useCallback((flowNodeId: string) => {
        setMarked(held => {
            const from = held.length > 0 ? held : [selected].filter((id): id is string => !!id);
            return from.includes(flowNodeId) ? from.filter(id => id !== flowNodeId) : [...from, flowNodeId];
        });
    }, [selected]);

    const clearMarks = useCallback(() => setMarked([]), []);

    const setMarkedIds = useCallback((flowNodeIds: string[]) => setMarked([...flowNodeIds]), []);

    /** Marks kept to the cards still there — a card that has left the board is not still picked out. */
    const forget = useCallback((gone: Set<string>) => {
        setMarked(held => (held.some(id => gone.has(id)) ? held.filter(id => !gone.has(id)) : held));
    }, []);

    const takeTitleCaret = useCallback(() => setTitleCaret(null), []);

    /**
     * Applies an operation that may find nothing to do, in which case the board does not move — and
     * sends the write that makes it true. `apply` with no write is a gesture the service has already
     * been told about, or one that changes nothing it keeps.
     */
    const apply = applyTo;

    const openBoard = useCallback((next: string) => {
        setHandle(prev => (prev === next ? prev : next));
    }, []);

    // A closed board keeps nothing; the hook drops what it held and lets go of the request it was
    // holding. Its next opening is a first opening, and reads the board again.
    const closeBoard = useCallback(() => {
        setHandle(null);
        setSelected(null);
        setSelectedWorkflow(null);
        setMarked([]);
        setExpanded(false);
    }, []);

    // Reading the board now rather than waiting to be told. Rarely needed — a change to this board
    // wakes the held request in the time a notification takes — and still worth offering: a client
    // that has just been told a run wrote something need not wait for its own watch to come round.
    const reloadBoard = reload;

    const chainFlowNode = useCallback((fromId: string, toId: string | null) => {
        apply(held => ops.chainFlowNode(held, fromId, toId),
            (client, board) => client.chainFlowNode(board, fromId, toId ?? ''));
    }, [apply]);

    const chainFlowNodeClass = useCallback((fromId: string, toId: string | null) => {
        apply(held => ops.chainFlowNodeClass(held, fromId, toId),
            (client, board) => client.chainFlowNodeClass(board, fromId, toId ?? ''));
    }, [apply]);

    // Cards and classes alike: the spots are written against whichever list holds the id, and
    // each write looks its own ids up in the result — an id of the other list is simply not
    // there, and costs nothing.
    const placeFlowNodes = useCallback((spots: Map<string, FlowNodeSpot>) => {
        apply(held => {
            const nodes = ops.placeFlowNodes(held, spots);
            const classes = ops.placeFlowNodeClasses(nodes ?? held, spots);
            return classes ?? nodes;
        }, async (client, board, before, after) => {
            await writes.writeSpots([...spots.keys()])(client, board, before, after);
            await writes.writeClassSpots([...spots.keys()])(client, board, before, after);
        });
    }, [apply]);

    // What a card dragged across the canvas writes. Which cards the gesture was about is
    // the board's own question — see `Board.onSpotMove` — and this only writes the answer.
    // Cards and classes alike.
    const moveSpots = useCallback((flowNodeIds: string[], dx: number, dy: number) => {
        apply(held => {
            const nodes = ops.moveSpots(held, flowNodeIds, dx, dy);
            const classes = ops.moveClassSpots(nodes ?? held, flowNodeIds, dx, dy);
            return classes ?? nodes;
        }, async (client, board, before, after) => {
            await writes.writeSpots(flowNodeIds)(client, board, before, after);
            await writes.writeClassSpots(flowNodeIds)(client, board, before, after);
        });
    }, [apply]);

    const editFlowNode = useCallback((flowNodeId: string, edit: FlowNodeEdit) => {
        // **No If-Match here**, and that is deliberate: this is a box somebody is typing in, and the
        // fields it writes are the fields nothing else writes. A run marks a status; it never types
        // a title. A revision check would turn "a run answered while I was typing"
        // into a refusal of my keystrokes, which is the one thing the whole field-level design was
        // for. Where two hands genuinely meet the same field, the later one wins and the change feed
        // shows it moving.
        apply(held => ops.editFlowNode(held, flowNodeId, edit),
            (client, board) => client.patchFlowNode(board, flowNodeId, writes.patchOf(edit)));
    }, [apply]);

    const removeFlowNodes = useCallback((flowNodeIds: string[]) => {
        apply(held => ops.removeFlowNodes(held, flowNodeIds),
            async (client, board, before, after) => {
                await client.deleteFlowNodes(board, flowNodeIds);
                // The rectangles the delete emptied go with their cards.
                await writes.writeDeleteEmptiedWorkflows()(client, board, before, after);
            });
        const gone = new Set(flowNodeIds);
        setSelected(prev => (prev && gone.has(prev) ? null : prev));
        forget(gone);
    }, [apply, forget]);

    const removeFlowNode = useCallback((flowNodeId: string) => removeFlowNodes([flowNodeId]), [removeFlowNodes]);

    const archiveFlowNodes = useCallback((flowNodeIds: string[]) => {
        apply(held => ops.archiveFlowNodes(held, flowNodeIds),
            async (client, board, before, after) => {
                for (const id of flowNodeIds) {
                    if (!ops.findFlowNode(after, id)) continue;
                    await client.patchFlowNode(board, id, { archived: true });
                }
            });
        const gone = new Set(flowNodeIds);
        setSelected(prev => (prev && gone.has(prev) ? null : prev));
        forget(gone);
    }, [apply, forget]);

    const unarchiveFlowNodes = useCallback((flowNodeIds: string[]) => {
        apply(held => ops.unarchiveFlowNodes(held, flowNodeIds),
            async (client, board, before, after) => {
                for (const id of flowNodeIds) {
                    if (!ops.findFlowNode(after, id)) continue;
                    await client.patchFlowNode(board, id, { archived: false });
                }
            });
    }, [apply]);

    const editFlowNodeClass = useCallback((classId: string, edit: FlowNodeClassEdit) => {
        apply(held => ops.editFlowNodeClass(held, classId, edit),
            (client, board) => client.patchFlowNodeClass(board, classId, writes.patchOfClass(edit)));
    }, [apply]);

    const removeFlowNodeClasses = useCallback((classIds: string[]) => {
        apply(held => ops.removeFlowNodeClasses(held, classIds),
            async (client, board, before, after) => {
                await client.deleteFlowNodeClasses(board, classIds);
                await writes.writeDeleteEmptiedWorkflowClasses()(client, board, before, after);
            });
        const gone = new Set(classIds);
        setSelected(prev => (prev && gone.has(prev) ? null : prev));
        forget(gone);
    }, [apply, forget]);

    // The class the canvas's menu makes: the kind that was picked, at the point that was
    // right-clicked — and opened, because an untitled class is one somebody is about to write.
    // Inside a rectangle where the menu named one: the grouping travels with the creation.
    const addFlowNodeClass = useCallback((type: FlowNodeType, spot: FlowNodeSpot, workflowClass = '') => {
        const flowNodeClass = { ...newFlowNodeClass(type, spot), workflowClass };
        apply(held => ops.insertFlowNodeClasses(held, [flowNodeClass]),
            writes.writeCreateClass(flowNodeClass));
        select(flowNodeClass.id);
        setTitleCaret(flowNodeClass.id);
    }, [apply, select]);

    // No optimistic version: the id is the service's to mint, so the board is read again once
    // it lands rather than drawing a version that would never match what comes back.
    const createClassVersion = useCallback((classId: string, from?: FlowNodeClassVersion) => {
        apply(held => held, async (client, board) => {
            await client.createClassVersion(board, classId, writes.newClassVersionDto(from));
            reload();
        });
    }, [apply, reload]);

    const editClassVersion = useCallback((classId: string, versionId: string, edit: ClassVersionEdit) => {
        apply(held => ops.editClassVersion(held, classId, versionId, edit),
            (client, board) => client.patchClassVersion(
                board, classId, versionId, writes.patchOfVersion(edit)));
    }, [apply]);

    const publishClassVersion = useCallback((classId: string, versionId: string) => {
        apply(held => ops.editClassVersion(held, classId, versionId, { status: 'published' }),
            (client, board) => client.patchClassVersion(
                board, classId, versionId, { status: 'published' }));
    }, [apply]);

    const deleteClassVersion = useCallback((classId: string, versionId: string) => {
        apply(held => ops.removeClassVersion(held, classId, versionId),
            (client, board) => client.deleteClassVersion(board, classId, versionId));
    }, [apply]);

    const convertFlowNodeToClass = useCallback((flowNodeId: string) => {
        apply(held => held, async (client, board) => {
            const made = await client.convertFlowNodeToClass(board, flowNodeId);
            reload();
            return made;
        });
    }, [apply, reload]);

    const instantiateFlowNodeClass = useCallback(
        (classId: string, spot: FlowNodeSpot, bodies?: InstantiateBodies, workflow = '') => {
            apply(held => held, async (client, board) => {
                const made = await client.instantiateFlowNodeClass(board, classId, spot, bodies);
                // Instantiated inside a rectangle: each node is grouped in it before the board
                // is read again, so the re-read never shows them outside it.
                if (workflow) {
                    for (const flowNode of made) {
                        await client.patchFlowNode(board, flowNode.id, { workflow });
                    }
                }
                reload();
                return made;
            });
        }, [apply, reload]);

    const instantiateWorkflowClass = useCallback(
        (workflowClassId: string, spot: FlowNodeSpot, bodies?: InstantiateBodies) => {
            apply(held => held, async (client, board) => {
                const made = await client.instantiateWorkflowClass(
                    board, workflowClassId, spot, bodies);
                reload();
                return made;
            });
        }, [apply, reload]);

    // The card the canvas's menu makes: the kind that was picked, at the point that was
    // right-clicked — and opened, because an untitled card is a card somebody is about to write.
    // The title box takes the focus, so the name is typed without a click first: the menu picked
    // no title.
    //
    // An AI card is made with what the store answers about a card nobody has been asked
    // about yet: the menu is what work for an agent is made from, so the card arrives typed for
    // one rather than typed Human and retyped by hand every time. The type is said out loud
    // rather than read off the settings, so a store with no agent filed yet still makes the
    // card the menu means — one wearing the incomplete mark, and not playable until one is picked.
    const addFlowNode = useCallback((type: FlowNodeType, spot: FlowNodeSpot, workflow = '') => {
        const flowNode: FlowNode = {
            ...newFlowNode('', '', newFlowNodeSettings(playDefaults, type)), type, spot, workflow,
        };
        apply(held => ops.insertFlowNodes(held, [flowNode]), writes.writeCreate([flowNode]));
        select(flowNode.id);
        setTitleCaret(flowNode.id);
    }, [apply, select, playDefaults]);

    // The rectangle the card menu's Create files: round the cards it was aimed at, and opened —
    // it arrives unnamed, and the panel it opens is where it is named. Which cards those are is
    // read off the board as it stands, not as it stood when the menu opened.
    const createWorkflow = useCallback((flowNodeIds: string[]) => {
        const workflow: Workflow = { id: newId(), name: '' };
        let members: string[] = [];
        apply(held => {
            members = ops.flowNodesNamed(held, flowNodeIds).map(flowNode => flowNode.id);
            if (members.length === 0) return null;
            return ops.groupFlowNodes(held, workflow, members);
        }, (client, board, before, after) =>
            writes.writeCreateWorkflow(workflow, members)(client, board, before, after));
        if (members.length > 0) {
            selectWorkflow({ kind: 'workflow', id: workflow.id });
            setTitleCaret(workflow.id);
        }
    }, [apply, selectWorkflow]);

    // The rectangle the class menu's Create files: round the classes it was aimed at.
    const createWorkflowClass = useCallback((classIds: string[]) => {
        const workflow: WorkflowClass = { id: newId(), name: '' };
        let members: string[] = [];
        apply(held => {
            members = ops.flowNodeClassesNamed(held, classIds).map(one => one.id);
            if (members.length === 0) return null;
            return ops.groupFlowNodeClasses(held, workflow, members);
        }, (client, board, before, after) =>
            writes.writeCreateWorkflowClass(workflow, members)(client, board, before, after));
        if (members.length > 0) {
            selectWorkflow({ kind: 'workflowClass', id: workflow.id });
            setTitleCaret(workflow.id);
        }
    }, [apply, selectWorkflow]);

    const editWorkflow = useCallback((workflowId: string, name: string) => {
        apply(held => ops.editWorkflow(held, workflowId, name),
            (client, board) => client.patchWorkflow(board, workflowId, { name }));
    }, [apply]);

    const editWorkflowClass = useCallback((workflowId: string, name: string) => {
        apply(held => ops.editWorkflowClass(held, workflowId, name),
            (client, board) => client.patchWorkflowClass(board, workflowId, { name }));
    }, [apply]);

    const removeWorkflows = useCallback((workflowIds: string[]) => {
        apply(held => ops.removeWorkflows(held, workflowIds),
            writes.writeDeleteWorkflows(workflowIds));
        const gone = new Set(workflowIds);
        setSelectedWorkflow(prev => (prev && gone.has(prev.id) ? null : prev));
    }, [apply]);

    const removeWorkflowClasses = useCallback((workflowIds: string[]) => {
        apply(held => ops.removeWorkflowClasses(held, workflowIds),
            writes.writeDeleteWorkflowClasses(workflowIds));
        const gone = new Set(workflowIds);
        setSelectedWorkflow(prev => (prev && gone.has(prev.id) ? null : prev));
    }, [apply]);

    const insertFlowNodes = useCallback((flowNodes: FlowNode[]) => {
        if (flowNodes.length === 0) return;
        apply(held => ops.insertFlowNodes(held, flowNodes), writes.writeCreate(flowNodes));
        select(flowNodes[0].id);
    }, [apply, select]);

    // The copy is opened, like every other card this board makes: two cards reading the same thing
    // is not what anybody asked for, and the panel is where the one just made is told apart from the
    // one it was made from.
    const cloneFlowNode = useCallback((flowNodeId: string) => {
        let copy: FlowNode | null = null;
        apply(held => {
            const done = ops.cloneFlowNode(held, flowNodeId);
            if (!done) return null;
            copy = done.flowNode;
            return done.content;
        }, (client, board, before, after) => (copy
            ? writes.writeCreate([copy])(client, board, before, after)
            : Promise.resolve()));
        if (copy) select((copy as FlowNode).id);
    }, [apply, select]);

    // The copy is opened, the way a cloned card is: two classes reading the same thing is not
    // what anybody asked for, and the panel is where the one just made is told apart.
    const cloneFlowNodeClass = useCallback((classId: string) => {
        let copy: FlowNodeClass | null = null;
        apply(held => {
            const done = ops.cloneFlowNodeClass(held, classId);
            if (!done) return null;
            copy = done.flowNodeClass;
            return done.content;
        }, (client, board, before, after) => (copy
            ? writes.writeCreateClass(copy)(client, board, before, after)
            : Promise.resolve()));
        if (copy) select((copy as FlowNodeClass).id);
    }, [apply, select]);

    const setFlowNodeStatus = useCallback((flowNodeId: string, status: FlowNodeStatus) => {
        apply(held => ops.setFlowNodeStatus(held, flowNodeId, status),
            (client, board) => client.patchFlowNode(board, flowNodeId, { status }));
    }, [apply]);

    const selectedFlowNode = useMemo(() => {
        if (!content || !selected) return null;
        const at = ops.findFlowNode(content, selected);
        return at && !at.flowNode.archived ? at : null;
    }, [content, selected]);

    const selectedClass = useMemo(
        () => (content && selected ? ops.findFlowNodeClass(content, selected) : null),
        [content, selected],
    );

    const selectedWorkflowGroup = useMemo(
        (): Workflow | WorkflowClass | null => {
            if (!content || !selectedWorkflow) return null;
            return selectedWorkflow.kind === 'workflow'
                ? ops.findWorkflow(content, selectedWorkflow.id)
                : ops.findWorkflowClass(content, selectedWorkflow.id);
        },
        [content, selectedWorkflow],
    );

    const value = useMemo(() => ({
        content, handle, error, loading, selected, select, openingId, selectedFlowNode, selectedClass,
        selectedWorkflow, selectWorkflow, selectedWorkflowGroup,
        expanded, setExpanded,
        marked, toggleMark, clearMarks, setMarked: setMarkedIds,
        titleCaret, takeTitleCaret,
        openBoard, closeBoard, reloadBoard,
        chainFlowNode, chainFlowNodeClass, placeFlowNodes, moveSpots, setFlowNodeStatus,
        addFlowNode, editFlowNode, removeFlowNode, removeFlowNodes, archiveFlowNodes, unarchiveFlowNodes,
        insertFlowNodes, cloneFlowNode,
        cloneFlowNodeClass,
        addFlowNodeClass, editFlowNodeClass, removeFlowNodeClasses,
        createClassVersion, editClassVersion, publishClassVersion, deleteClassVersion,
        convertFlowNodeToClass, instantiateFlowNodeClass, instantiateWorkflowClass,
        createWorkflow, createWorkflowClass, editWorkflow, editWorkflowClass,
        removeWorkflows, removeWorkflowClasses,
    }), [
        content, handle, error, loading, selected, select, openingId, selectedFlowNode, selectedClass,
        selectedWorkflow, selectWorkflow, selectedWorkflowGroup,
        expanded,
        marked, toggleMark, clearMarks, setMarkedIds,
        titleCaret, takeTitleCaret,
        openBoard, closeBoard, reloadBoard,
        chainFlowNode, chainFlowNodeClass, placeFlowNodes, moveSpots, setFlowNodeStatus,
        addFlowNode, editFlowNode, removeFlowNode, removeFlowNodes, archiveFlowNodes, unarchiveFlowNodes,
        insertFlowNodes, cloneFlowNode,
        cloneFlowNodeClass,
        addFlowNodeClass, editFlowNodeClass, removeFlowNodeClasses,
        createClassVersion, editClassVersion, publishClassVersion, deleteClassVersion,
        convertFlowNodeToClass, instantiateFlowNodeClass, instantiateWorkflowClass,
        createWorkflow, createWorkflowClass, editWorkflow, editWorkflowClass,
        removeWorkflows, removeWorkflowClasses,
    ]);

    return <HybridflowContext.Provider value={value}>{children}</HybridflowContext.Provider>;
};
