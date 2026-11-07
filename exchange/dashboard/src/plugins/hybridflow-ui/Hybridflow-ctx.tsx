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
    content: BoardContent | null;

    handle: string | null;
    error: string | null;
    loading: boolean;
    selected: string | null;
    select: (flowNodeId: string | null) => void;

    marked: string[];
    toggleMark: (flowNodeId: string) => void;
    clearMarks: () => void;
    setMarked: (flowNodeIds: string[]) => void;

    openingId: number;
    selectedFlowNode: ops.FlowNodeAt | null;
    selectedClass: ops.FlowNodeClassAt | null;
    selectedWorkflow: SelectedWorkflow | null;
    selectWorkflow: (workflow: SelectedWorkflow | null) => void;
    selectedWorkflowGroup: Workflow | WorkflowClass | null;
    expanded: boolean;
    setExpanded: (open: boolean) => void;
    working: string | null;
    setWorking: (flowNodeId: string | null) => void;
    openBoard: (handle: string) => void;

    reloadBoard: () => void;
    closeBoard: () => void;
    chainFlowNode: (fromId: string, toId: string | null) => void;
    placeFlowNodes: (spots: Map<string, FlowNodeSpot>) => void;
    moveSpots: (flowNodeIds: string[], dx: number, dy: number) => void;
    chainFlowNodeClass: (fromId: string, toId: string | null) => void;

    setFlowNodeStatus: (flowNodeId: string, status: FlowNodeStatus) => void;

    addFlowNode: (type: FlowNodeType, spot: FlowNodeSpot, workflow?: string) => void;
    editFlowNode: (flowNodeId: string, edit: FlowNodeEdit) => void;
    removeFlowNode: (flowNodeId: string) => void;
    removeFlowNodes: (flowNodeIds: string[]) => void;
    archiveFlowNodes: (flowNodeIds: string[]) => void;
    unarchiveFlowNodes: (flowNodeIds: string[]) => void;

    cloneFlowNodeClass: (classId: string) => void;

    insertFlowNodes: (flowNodes: FlowNode[]) => void;

    cloneFlowNode: (flowNodeId: string) => void;

    addFlowNodeClass: (type: FlowNodeType, spot: FlowNodeSpot, workflowClass?: string) => void;
    editFlowNodeClass: (classId: string, edit: FlowNodeClassEdit) => void;
    removeFlowNodeClasses: (classIds: string[]) => void;

    createClassVersion: (classId: string, from?: FlowNodeClassVersion) => void;
    editClassVersion: (classId: string, versionId: string, edit: ClassVersionEdit) => void;
    publishClassVersion: (classId: string, versionId: string) => void;
    deleteClassVersion: (classId: string, versionId: string) => void;

    convertFlowNodeToClass: (flowNodeId: string) => void;

    instantiateFlowNodeClass: (
        classId: string, spot: FlowNodeSpot, bodies?: InstantiateBodies, workflow?: string,
    ) => void;

    instantiateWorkflowClass: (
        workflowClassId: string, spot: FlowNodeSpot, bodies?: InstantiateBodies,
    ) => void;

    createWorkflow: (flowNodeIds: string[]) => void;

    createWorkflowClass: (classIds: string[]) => void;
    editWorkflow: (workflowId: string, name: string) => void;
    editWorkflowClass: (workflowId: string, name: string) => void;
    removeWorkflows: (workflowIds: string[]) => void;
    removeWorkflowClasses: (workflowIds: string[]) => void;

    titleCaret: string | null;
    takeTitleCaret: () => void;
}

const HybridflowContext = createContext<HybridflowValue | null>(null);

export const useHybridflow = (): HybridflowValue => {
    const context = useContext(HybridflowContext);
    if (!context) throw new Error('useHybridflow must be used within a HybridflowProvider');
    return context;
};

/** Holds board state for the app lifetime. */
export const HybridflowProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const [handle, setHandle] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [selectedWorkflow, setSelectedWorkflow] = useState<SelectedWorkflow | null>(null);
    const [marked, setMarked] = useState<string[]>([]);
    const [openingId, setOpeningId] = useState(0);
    const [expanded, setExpanded] = useState(false);
    const [working, setWorking] = useState<string | null>(null);
    const [titleCaret, setTitleCaret] = useState<string | null>(null);
    const playDefaults = usePlayDefaults();

    const { content, loading, error, apply: applyTo, reload } = useBoardSync(handle);

    const select = useCallback((flowNodeId: string | null) => {
        setSelected(flowNodeId);
        setSelectedWorkflow(null);
        setOpeningId(id => id + 1);
        setExpanded(false);
        setTitleCaret(null);
        setMarked([]);
    }, []);

    const selectWorkflow = useCallback((workflow: SelectedWorkflow | null) => {
        setSelectedWorkflow(workflow);
        setSelected(null);
        setExpanded(false);
        setTitleCaret(null);
        setMarked([]);
    }, []);

    const toggleMark = useCallback((flowNodeId: string) => {
        setMarked(held => {
            const from = held.length > 0 ? held : [selected].filter((id): id is string => !!id);
            return from.includes(flowNodeId) ? from.filter(id => id !== flowNodeId) : [...from, flowNodeId];
        });
    }, [selected]);

    const clearMarks = useCallback(() => setMarked([]), []);

    const setMarkedIds = useCallback((flowNodeIds: string[]) => setMarked([...flowNodeIds]), []);

    const forget = useCallback((gone: Set<string>) => {
        setMarked(held => (held.some(id => gone.has(id)) ? held.filter(id => !gone.has(id)) : held));
    }, []);

    const takeTitleCaret = useCallback(() => setTitleCaret(null), []);

    const apply = applyTo;

    const openBoard = useCallback((next: string) => {
        setHandle(prev => (prev === next ? prev : next));
    }, []);

    const closeBoard = useCallback(() => {
        setHandle(null);
        setSelected(null);
        setSelectedWorkflow(null);
        setMarked([]);
        setExpanded(false);
        setWorking(null);
    }, []);

    const reloadBoard = reload;

    const chainFlowNode = useCallback((fromId: string, toId: string | null) => {
        apply(held => ops.chainFlowNode(held, fromId, toId),
            (client, board) => client.chainFlowNode(board, fromId, toId ?? ''));
    }, [apply]);

    const chainFlowNodeClass = useCallback((fromId: string, toId: string | null) => {
        apply(held => ops.chainFlowNodeClass(held, fromId, toId),
            (client, board) => client.chainFlowNodeClass(board, fromId, toId ?? ''));
    }, [apply]);

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

        apply(held => ops.editFlowNode(held, flowNodeId, edit),
            (client, board) => client.patchFlowNode(board, flowNodeId, writes.patchOf(edit)));
    }, [apply]);

    const removeFlowNodes = useCallback((flowNodeIds: string[]) => {
        apply(held => ops.removeFlowNodes(held, flowNodeIds),
            async (client, board, before, after) => {
                await client.deleteFlowNodes(board, flowNodeIds);
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

    const addFlowNodeClass = useCallback((type: FlowNodeType, spot: FlowNodeSpot, workflowClass = '') => {
        const flowNodeClass = { ...newFlowNodeClass(type, spot), workflowClass };
        apply(held => ops.insertFlowNodeClasses(held, [flowNodeClass]),
            writes.writeCreateClass(flowNodeClass));
        select(flowNodeClass.id);
        setTitleCaret(flowNodeClass.id);
    }, [apply, select]);

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

    const addFlowNode = useCallback((type: FlowNodeType, spot: FlowNodeSpot, workflow = '') => {
        const flowNode: FlowNode = {
            ...newFlowNode('', '', newFlowNodeSettings(playDefaults, type)), type, spot, workflow,
        };
        apply(held => ops.insertFlowNodes(held, [flowNode]), writes.writeCreate([flowNode]));
        select(flowNode.id);
        setTitleCaret(flowNode.id);
    }, [apply, select, playDefaults]);

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
        expanded, setExpanded, working, setWorking,
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
        expanded, working,
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
