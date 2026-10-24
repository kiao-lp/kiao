import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkerClient } from '@cms-core';
import { FlowNodeEdit } from './boardOps';
import { useHybridflow } from './Hybridflow-ctx';
import { SettingsChanges, withSettings } from './flowNodeSettings';
import { readSchedule } from './flowNodeSchedule';
import { FlowNodeStatus } from './flowNodeStatus';
import { successFor, FlowNodeSuccess } from './flowNodeSuccess';
import { ensureDefaultFlowNodeTemplates, templateForType } from './flowNodeTemplates';
import { FlowNodeType, isTask, typeChanges } from './flowNodeType';
import { usePlayDefaults } from './usePlayDefaults';
import { SuccessCriterion, TaskComplexity } from './boardContent';

interface FlowNodeEditingValue {
    /** Draft texts; local echoes must not re-seed CodeMirror and reset its caret. */
    title: string;
    body: string;
    note: string;
    valueText: string;
    valueError: string;
    editTitle: (next: string) => void;
    editBody: (next: string) => void;
    editNote: (next: string) => void;
    editValueText: (next: string) => void;
    editTags: (next: string[]) => void;
    editCriteria: (next: SuccessCriterion[]) => void;
    editComplexity: (next: TaskComplexity) => void;
    editMeta: (changes: SettingsChanges) => void;
    editType: (next: FlowNodeType) => void;
    editSchedule: (next: string, duration?: string) => void;
    editSuccess: (next: FlowNodeSuccess) => void;
    editStatus: (next: FlowNodeStatus) => void;
    unlinkChat: () => void;
    /** Template paths and shared selection, seeded by node type; selection is not persisted. */
    templates: string[];
    templatePath: string | null;
    pickTemplate: (path: string | null) => void;
}

const FlowNodeEditingContext = createContext<FlowNodeEditingValue | null>(null);

export const useFlowNodeEditing = (): FlowNodeEditingValue => {
    const context = useContext(FlowNodeEditingContext);
    if (!context) throw new Error('useFlowNodeEditing must be used within a FlowNodeEditingProvider');
    return context;
};

/**
 * Share one draft between the panel and large editor to prevent stale overwrites.
 * This provider must outlive either editor, including a hidden toolbar's unmounted tab.
 */
export const FlowNodeEditingProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const { handle, selectedFlowNode, openingId, editFlowNode, setFlowNodeStatus } = useHybridflow();
    const client = useWorkerClient();
    // Use the store's first agent; typeChanges leaves the board's permission default alone.
    const playDefaults = usePlayDefaults();
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [note, setNote] = useState('');
    const [valueText, setValueText] = useState('{}');
    const [valueError, setValueError] = useState('');
    const [templates, setTemplates] = useState<string[]>([]);
    const [templatePath, setTemplatePath] = useState<string | null>(null);

    const flowNode = selectedFlowNode?.flowNode ?? null;
    const flowNodeId = flowNode?.id ?? null;

    /**
     * Ensure templates only when a board opens; this provider also lives on non-board pages.
     * Reload per board to discover new templates. The client ref avoids render-driven listings.
     */
    const workerClient = useRef(client);
    workerClient.current = client;
    useEffect(() => {
        if (!handle) return;
        let cancelled = false;
        ensureDefaultFlowNodeTemplates(workerClient.current)
            .catch((): string[] => [])
            .then(found => { if (!cancelled) setTemplates(found); });
        return () => { cancelled = true; };
    }, [handle]);

    // Distinguish local write echoes from external changes to the open node.
    const written = useRef({ title: '', body: '', note: '', valueText: '{}' });

    // Re-seed on reopening even the same id, and reset its template choice.
    useEffect(() => {
        written.current = {
            title: flowNode?.title ?? '', body: flowNode?.body ?? '',
            note: flowNode?.note ?? '', valueText: JSON.stringify(flowNode?.value ?? {}, null, 2),
        };
        setTitle(written.current.title);
        setBody(written.current.body);
        setNote(written.current.note);
        setValueText(written.current.valueText);
        setValueError('');
        setTemplatePath(flowNode ? templateForType(flowNode.type) : null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openingId, flowNodeId]);

    // Apply external changes without re-seeding, preserving the caret and preventing stale writes.
    useEffect(() => {
        if (!flowNode) return;
        if (flowNode.title !== written.current.title) {
            written.current.title = flowNode.title;
            setTitle(flowNode.title);
        }
        if (flowNode.body !== written.current.body) {
            written.current.body = flowNode.body;
            setBody(flowNode.body);
        }
        if (flowNode.note !== written.current.note) {
            written.current.note = flowNode.note;
            setNote(flowNode.note);
        }
        const held = JSON.stringify(flowNode.value ?? {}, null, 2);
        if (held !== written.current.valueText) {
            written.current.valueText = held;
            setValueText(held);
            setValueError('');
        }
    }, [flowNode]);

    const editTitle = useCallback((next: string) => {
        if (!flowNodeId) return;
        written.current.title = next;
        setTitle(next);
        editFlowNode(flowNodeId, { title: next });
    }, [flowNodeId, editFlowNode]);

    const editBody = useCallback((next: string) => {
        if (!flowNodeId) return;
        written.current.body = next;
        setBody(next);
        editFlowNode(flowNodeId, { body: next });
    }, [flowNodeId, editFlowNode]);

    const editNote = useCallback((next: string) => {
        if (!flowNodeId) return;
        written.current.note = next;
        setNote(next);
        editFlowNode(flowNodeId, { note: next });
    }, [flowNodeId, editFlowNode]);

    const editValueText = useCallback((next: string) => {
        if (!flowNodeId) return;
        setValueText(next);
        try {
            const parsed: unknown = JSON.parse(next);
            written.current.valueText = next;
            setValueError('');
            editFlowNode(flowNodeId, { value: parsed });
        } catch {
            setValueError('Invalid JSON');
        }
    }, [flowNodeId, editFlowNode]);

    // Settings edits must not implicitly replace the body; template insertion is explicit.
    const writeMeta = useCallback((changes: SettingsChanges, also?: FlowNodeEdit) => {
        if (!flowNode) return;
        editFlowNode(flowNode.id, { settings: withSettings(flowNode.settings, changes), ...also });
    }, [flowNode, editFlowNode]);

    const editMeta = useCallback((changes: SettingsChanges) => writeMeta(changes), [writeMeta]);

    /**
     * Clear fields unsupported by the new type so hidden values cannot invalidate the node.
     * Preserve chat history and any still-valid successor: chains are independent of who plays them.
     */
    const editType = useCallback((next: FlowNodeType) => {
        if (!flowNode) return;
        const at = next === 'scheduler' ? flowNode.at : '';
        const onSuccess = successFor(flowNode.onSuccess, next);
        // Non-tasks cannot expose controls to repair criteria or complexity.
        const task = isTask(next) ? {} : { criteria: [], complexity: null } as FlowNodeEdit;
        writeMeta(typeChanges(flowNode.settings, next, playDefaults), {
            type: next,
            ...(at === flowNode.at ? {} : { at }),
            ...(next !== 'scheduler' && flowNode.duration ? { duration: '' } : {}),
            ...(onSuccess === flowNode.onSuccess ? {} : { onSuccess }),
            ...task,
        });
        // Keep the template for types without one, so switching back retains the choice.
        const offered = templateForType(next);
        if (offered) setTemplatePath(offered);
    }, [flowNode, writeMeta, playDefaults]);

    // Clearing the schedule leaves the card unplayable.
    const editSchedule = useCallback((next: string, duration = '') => {
        if (flowNodeId) editFlowNode(flowNodeId, { at: readSchedule(next), duration });
    }, [flowNodeId, editFlowNode]);

    const editTags = useCallback((next: string[]) => {
        if (flowNodeId) editFlowNode(flowNodeId, { tags: next });
    }, [flowNodeId, editFlowNode]);

    const editCriteria = useCallback((next: SuccessCriterion[]) => {
        if (flowNodeId) editFlowNode(flowNodeId, { criteria: next });
    }, [flowNodeId, editFlowNode]);

    const editComplexity = useCallback((next: TaskComplexity) => {
        if (flowNodeId) editFlowNode(flowNodeId, { complexity: next });
    }, [flowNodeId, editFlowNode]);

    const editSuccess = useCallback((next: FlowNodeSuccess) => {
        if (flowNodeId) editFlowNode(flowNodeId, { onSuccess: next });
    }, [flowNodeId, editFlowNode]);

    const editStatus = useCallback((next: FlowNodeStatus) => {
        if (flowNodeId) setFlowNodeStatus(flowNodeId, next);
    }, [flowNodeId, setFlowNodeStatus]);

    const unlinkChat = useCallback(() => {
        if (flowNodeId) editFlowNode(flowNodeId, { chat: '' });
    }, [flowNodeId, editFlowNode]);

    const value = useMemo(() => ({
        title, body, note, valueText, valueError, editTitle, editBody, editNote, editValueText,
        editTags, editCriteria, editComplexity,
        editMeta, editType, editSchedule,
        editSuccess, editStatus, unlinkChat, templates, templatePath, pickTemplate: setTemplatePath,
    }), [title, body, note, valueText, valueError, editTitle, editBody, editNote, editValueText,
        editTags, editCriteria, editComplexity,
        editMeta, editType, editSchedule,
        editSuccess, editStatus, unlinkChat, templates, templatePath]);

    return <FlowNodeEditingContext.Provider value={value}>{children}</FlowNodeEditingContext.Provider>;
};
