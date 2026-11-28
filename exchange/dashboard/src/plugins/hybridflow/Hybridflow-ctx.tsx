import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as ops from './boardOps';
import * as writes from './boardWrites';
import { boardUrl, taskUrl, useLinkedTaskId } from './boardRoute';
import { useBoardSync } from './useBoardSync';
import { FlowNodeEdit } from './boardOps';
import { BoardSummary, type WorkflowPatchDto } from './service';
import { FlowNodeSpot } from './flowNodeSpot';
import { readLimiter } from './flowNodeLimiter';
import { FlowNodeStatus } from './flowNodeStatus';
import { newFlowNodeSettings, FlowNodeType } from './flowNodeType';
import type { WorkflowValuesPatch } from './workflowValues';
type WorkflowFilesPatch = Pick<WorkflowPatchDto, 'workflowFolder' | 'files'>;
import {
    newFlowNode, newId, BoardContent, FlowNode, Workflow,
} from './boardContent';

interface HybridflowValue {
    content: BoardContent | null;

    board: BoardSummary | null;
    handle: string | null;
    error: string | null;
    loading: boolean;
    selected: string | null;
    select: (flowNodeId: string | null) => void;
    openTask: (taskId: string) => void;
    selectFromRoute: (taskId: string | null) => void;

    marked: string[];
    toggleMark: (flowNodeId: string) => void;
    clearMarks: () => void;
    setMarked: (flowNodeIds: string[]) => void;

    openingId: number;
    selectedFlowNode: ops.FlowNodeAt | null;
    selectedWorkflow: string | null;
    selectWorkflow: (workflow: string | null) => void;
    selectedWorkflowGroup: Workflow | null;
    working: string | null;
    setWorking: (flowNodeId: string | null) => void;
    openBoard: (handle: string) => void;

    reloadBoard: () => void;
    closeBoard: () => void;
    chainFlowNode: (fromId: string, toId: string | null) => void;
    placeFlowNodes: (spots: Map<string, FlowNodeSpot>) => void;
    moveSpots: (flowNodeIds: string[], dx: number, dy: number) => void;

    setFlowNodeStatus: (flowNodeId: string, status: FlowNodeStatus) => void;

    addFlowNode: (type: FlowNodeType, spot: FlowNodeSpot, workflow?: string, agent?: string) => void;
    editFlowNode: (flowNodeId: string, edit: FlowNodeEdit) => Promise<boolean>;
    removeFlowNode: (flowNodeId: string) => void;
    removeFlowNodes: (flowNodeIds: string[]) => void;
    archiveFlowNodes: (flowNodeIds: string[]) => void;
    unarchiveFlowNodes: (flowNodeIds: string[]) => void;

    insertFlowNodes: (flowNodes: FlowNode[]) => void;

    cloneFlowNode: (flowNodeId: string) => void;

    createWorkflow: (flowNodeIds: string[]) => void;
    pasteWorkflow: (clipboard: Record<string, unknown>, spot?: FlowNodeSpot) => Promise<boolean>;

    editWorkflow: (workflowId: string, name: string) => void;
    editWorkflowValues: (workflowId: string, patch: WorkflowValuesPatch) => Promise<boolean>;
    editWorkflowFiles: (workflowId: string, edit: (workflow: Workflow) => WorkflowFilesPatch | null) => Promise<boolean>;
    removeWorkflows: (workflowIds: string[]) => void;

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
    const navigate = useNavigate();
    const linkedTaskId = useLinkedTaskId();
    const [boardAddress, setBoardAddress] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
    const [marked, setMarked] = useState<string[]>([]);
    const [openingId, setOpeningId] = useState(0);
    const [working, setWorking] = useState<string | null>(null);
    const [titleCaret, setTitleCaret] = useState<string | null>(null);

    const { board, content, loading, error, apply: applyTo, enqueueWrite, reload } = useBoardSync(boardAddress);
    const handle = board?.slug ?? boardAddress;

    const selectFromRoute = useCallback((flowNodeId: string | null) => {
        setSelected(flowNodeId);
        setSelectedWorkflow(null);
        setOpeningId(id => id + 1);
        setTitleCaret(null);
        setMarked([]);
    }, []);

    const leaveTaskUrl = useCallback(() => {
        if (linkedTaskId && handle) navigate(boardUrl(handle), { replace: true });
    }, [linkedTaskId, handle, navigate]);

    const select = useCallback((flowNodeId: string | null) => {
        if (flowNodeId !== linkedTaskId) leaveTaskUrl();
        selectFromRoute(flowNodeId);
    }, [linkedTaskId, leaveTaskUrl, selectFromRoute]);

    const openTask = useCallback((taskId: string) => {
        if (!board) return;
        if (taskId !== linkedTaskId) navigate(taskUrl(taskId, board.id));
        selectFromRoute(taskId);
    }, [board, linkedTaskId, navigate, selectFromRoute]);

    const selectWorkflow = useCallback((workflow: string | null) => {
        leaveTaskUrl();
        setSelectedWorkflow(workflow);
        setSelected(null);
        setTitleCaret(null);
        setMarked([]);
    }, [leaveTaskUrl]);

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

    const resetBoardSelection = useCallback(() => {
        selectFromRoute(null);
        setWorking(null);
    }, [selectFromRoute]);

    const openBoard = useCallback((next: string) => {
        if (next === boardAddress || next === board?.id || next === board?.slug) return;
        setBoardAddress(next);
        resetBoardSelection();
    }, [boardAddress, board?.id, board?.slug, resetBoardSelection]);

    const closeBoard = useCallback(() => {
        setBoardAddress(null);
        resetBoardSelection();
    }, [resetBoardSelection]);

    const reloadBoard = reload;

    const chainFlowNode = useCallback((fromId: string, toId: string | null) => {
        apply(held => ops.chainFlowNode(held, fromId, toId),
            (client, board) => client.chainFlowNode(board, fromId, toId ?? ''));
    }, [apply]);

    const placeFlowNodes = useCallback((spots: Map<string, FlowNodeSpot>) => {
        apply(held => ops.placeFlowNodes(held, spots), writes.writeSpots([...spots.keys()]));
    }, [apply]);

    const moveSpots = useCallback((flowNodeIds: string[], dx: number, dy: number) => {
        apply(held => ops.moveSpots(held, flowNodeIds, dx, dy), writes.writeSpots(flowNodeIds));
    }, [apply]);

    const editFlowNode = useCallback((flowNodeId: string, edit: FlowNodeEdit) => {

        return apply(held => ops.editFlowNode(held, flowNodeId, edit),
            (client, board) => client.patchFlowNode(board, flowNodeId, writes.patchOf(edit)));
    }, [apply]);

    const removeFlowNodes = useCallback((flowNodeIds: string[]) => {
        apply(held => ops.removeFlowNodes(held, flowNodeIds),
            async (client, board, before, after) => {
                await client.deleteFlowNodes(board, flowNodeIds);
                await writes.writeDeleteEmptiedWorkflows()(client, board, before, after);
            });
        const gone = new Set(flowNodeIds);
        if (linkedTaskId && gone.has(linkedTaskId)) leaveTaskUrl();
        setSelected(prev => (prev && gone.has(prev) ? null : prev));
        forget(gone);
    }, [apply, forget, linkedTaskId, leaveTaskUrl]);

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
        if (linkedTaskId && gone.has(linkedTaskId)) leaveTaskUrl();
        setSelected(prev => (prev && gone.has(prev) ? null : prev));
        forget(gone);
    }, [apply, forget, linkedTaskId, leaveTaskUrl]);

    const unarchiveFlowNodes = useCallback((flowNodeIds: string[]) => {
        apply(held => ops.unarchiveFlowNodes(held, flowNodeIds),
            async (client, board, before, after) => {
                for (const id of flowNodeIds) {
                    if (!ops.findFlowNode(after, id)) continue;
                    await client.patchFlowNode(board, id, { archived: false });
                }
            });
    }, [apply]);

    const pasteWorkflow = useCallback((clipboard: Record<string, unknown>, spot?: FlowNodeSpot) =>
        apply(held => held, async (client, board) => {
            await client.pasteWorkflow(board, clipboard, spot);
            await reload(board);
        }), [apply, reload]);

    const addFlowNode = useCallback((type: FlowNodeType, spot: FlowNodeSpot, workflow = '', agent = '') => {
        const flowNode: FlowNode = {
            ...newFlowNode('', '', { ...newFlowNodeSettings(type), ...(agent ? { agent } : {}) }), type, spot, workflow,
            ...(type === 'limiter' ? readLimiter({}) : {}),
        };
        apply(held => ops.insertFlowNodes(held, [flowNode]), writes.writeCreate([flowNode]));
        select(flowNode.id);
        setTitleCaret(flowNode.id);
    }, [apply, select]);

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
            selectWorkflow(workflow.id);
            setTitleCaret(workflow.id);
        }
    }, [apply, selectWorkflow]);

    const editWorkflow = useCallback((workflowId: string, name: string) => {
        apply(held => ops.editWorkflow(held, workflowId, name),
            (client, board) => client.patchWorkflow(board, workflowId, { name }));
    }, [apply]);

    const editWorkflowValues = useCallback((workflowId: string, patch: WorkflowValuesPatch) => {
        if (!boardAddress) return Promise.resolve(false);
        return enqueueWrite(boardAddress, async (client, target) => {
            await client.patchWorkflow(target, workflowId, patch);
            await reload(target);
        });
    }, [boardAddress, enqueueWrite, reload]);

    const editWorkflowFiles = useCallback<HybridflowValue['editWorkflowFiles']>((workflowId, edit) => {
        if (!boardAddress) return Promise.resolve(false);
        return enqueueWrite(boardAddress, async (client, target) => {
            const workflow = await client.workflow(target, workflowId);
            const patch = edit(workflow);
            if (patch) await client.patchWorkflow(target, workflowId, patch, workflow.revision);
            await reload(target);
        });
    }, [boardAddress, enqueueWrite, reload]);

    const removeWorkflows = useCallback((workflowIds: string[]) => {
        apply(held => ops.removeWorkflows(held, workflowIds),
            writes.writeDeleteWorkflows(workflowIds));
        const gone = new Set(workflowIds);
        setSelectedWorkflow(prev => (prev && gone.has(prev) ? null : prev));
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

    const setFlowNodeStatus = useCallback((flowNodeId: string, status: FlowNodeStatus) => {
        apply(held => ops.setFlowNodeStatus(held, flowNodeId, status),
            (client, board) => client.patchFlowNode(board, flowNodeId, { status }));
    }, [apply]);

    const selectedFlowNode = useMemo(() => {
        if (!content || !selected) return null;
        const at = ops.findFlowNode(content, selected);
        return at && !at.flowNode.archived ? at : null;
    }, [content, selected]);

    const selectedWorkflowGroup = useMemo(
        () => content && selectedWorkflow ? ops.findWorkflow(content, selectedWorkflow) : null,
        [content, selectedWorkflow],
    );

    const value = useMemo(() => ({
        content, board, handle, error, loading, selected, select, openTask, selectFromRoute, openingId, selectedFlowNode,
        selectedWorkflow, selectWorkflow, selectedWorkflowGroup,
        working, setWorking,
        marked, toggleMark, clearMarks, setMarked: setMarkedIds,
        titleCaret, takeTitleCaret,
        openBoard, closeBoard, reloadBoard,
        chainFlowNode, placeFlowNodes, moveSpots, setFlowNodeStatus,
        addFlowNode, editFlowNode, removeFlowNode, removeFlowNodes, archiveFlowNodes, unarchiveFlowNodes,
        insertFlowNodes, cloneFlowNode,
        createWorkflow, pasteWorkflow, editWorkflow, editWorkflowValues, editWorkflowFiles,
        removeWorkflows,
    }), [
        content, board, handle, error, loading, selected, select, openTask, selectFromRoute, openingId, selectedFlowNode,
        selectedWorkflow, selectWorkflow, selectedWorkflowGroup,
        working,
        marked, toggleMark, clearMarks, setMarkedIds,
        titleCaret, takeTitleCaret,
        openBoard, closeBoard, reloadBoard,
        chainFlowNode, placeFlowNodes, moveSpots, setFlowNodeStatus,
        addFlowNode, editFlowNode, removeFlowNode, removeFlowNodes, archiveFlowNodes, unarchiveFlowNodes,
        insertFlowNodes, cloneFlowNode,
        createWorkflow, pasteWorkflow, editWorkflow, editWorkflowValues, editWorkflowFiles,
        removeWorkflows,
    ]);

    return <HybridflowContext.Provider value={value}>{children}</HybridflowContext.Provider>;
};
