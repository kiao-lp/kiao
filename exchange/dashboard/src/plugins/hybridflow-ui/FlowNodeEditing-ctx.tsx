import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkerClient } from '@kiao-dashboard-core';
import { FlowNodeEdit } from './boardOps';
import { useHybridflow } from './Hybridflow-ctx';
import { RUNNER_KEY, SettingsChanges, withSettings } from './flowNodeSettings';
import { readSchedule } from './flowNodeSchedule';
import { FlowNodeStatus, taskInputsReadOnly } from './flowNodeStatus';
import { FlowNodeSuccess } from './flowNodeSuccess';
import { ensureDefaultFlowNodeTemplates, templateForType } from './flowNodeTemplates';
import { SuccessCriterion, TaskComplexity } from './boardContent';

interface FlowNodeEditingValue {
    readOnly: boolean;
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
    editValueType: (next: string) => void;
    editOutputType: (next: string) => void;
    editTags: (next: string[]) => void;
    editCriteria: (next: SuccessCriterion[]) => void;
    editComplexity: (next: TaskComplexity) => void;
    editMeta: (changes: SettingsChanges) => void;
    editSchedule: (next: string, duration?: string) => void;
    editSuccess: (next: FlowNodeSuccess) => void;
    editStatus: (next: FlowNodeStatus) => void;
    unlinkChat: () => void;

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

/** One draft for the node panel; it outlives a hidden toolbar's unmounted tab. */
export const FlowNodeEditingProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const { handle, selectedFlowNode, openingId, editFlowNode, setFlowNodeStatus } = useHybridflow();
    const client = useWorkerClient();

    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [note, setNote] = useState('');
    const [valueText, setValueText] = useState('{}');
    const [valueError, setValueError] = useState('');
    const [templates, setTemplates] = useState<string[]>([]);
    const [templatePath, setTemplatePath] = useState<string | null>(null);

    const flowNode = selectedFlowNode?.flowNode ?? null;
    const flowNodeId = flowNode?.id ?? null;
    const readOnly = !!flowNode && taskInputsReadOnly(flowNode.type, flowNode.status);

    const readOnlyRef = useRef(readOnly);
    readOnlyRef.current = readOnly;

    /** Ensure templates only when a board opens; this provider also lives on non-board pages. */
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

    const written = useRef({ title: '', body: '', note: '', valueText: '{}' });

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
        if (!flowNodeId || readOnlyRef.current) return;
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

    const editValueType = useCallback((next: string) => {
        if (flowNodeId) editFlowNode(flowNodeId, { valueType: next });
    }, [flowNodeId, editFlowNode]);

    const editOutputType = useCallback((next: string) => {
        if (flowNodeId && !readOnlyRef.current) editFlowNode(flowNodeId, { outputType: next });
    }, [flowNodeId, editFlowNode]);

    const editValueText = useCallback((next: string) => {
        if (!flowNodeId) return;
        setValueText(next);
        try {
            const parsed: unknown = JSON.parse(next);
            written.current.valueText = JSON.stringify(parsed ?? {}, null, 2);
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

    const editMeta = useCallback((changes: SettingsChanges) => {
        if (readOnlyRef.current && Object.keys(changes).some(key => key !== RUNNER_KEY)) return;
        writeMeta(changes);
    }, [writeMeta]);

    const editSchedule = useCallback((next: string, duration = '') => {
        if (flowNodeId) editFlowNode(flowNodeId, { at: readSchedule(next), duration });
    }, [flowNodeId, editFlowNode]);

    const editTags = useCallback((next: string[]) => {
        if (flowNodeId) editFlowNode(flowNodeId, { tags: next });
    }, [flowNodeId, editFlowNode]);

    const editCriteria = useCallback((next: SuccessCriterion[]) => {
        if (flowNodeId && !readOnlyRef.current) editFlowNode(flowNodeId, { criteria: next });
    }, [flowNodeId, editFlowNode]);

    const editComplexity = useCallback((next: TaskComplexity) => {
        if (flowNodeId) editFlowNode(flowNodeId, { complexity: next });
    }, [flowNodeId, editFlowNode]);

    const editSuccess = useCallback((next: FlowNodeSuccess) => {
        if (flowNodeId && !readOnlyRef.current) editFlowNode(flowNodeId, { onSuccess: next });
    }, [flowNodeId, editFlowNode]);

    const editStatus = useCallback((next: FlowNodeStatus) => {
        if (flowNodeId) setFlowNodeStatus(flowNodeId, next);
    }, [flowNodeId, setFlowNodeStatus]);

    const unlinkChat = useCallback(() => {
        if (flowNodeId) editFlowNode(flowNodeId, { chat: '' });
    }, [flowNodeId, editFlowNode]);

    const value = useMemo(() => ({
        readOnly, title, body, note, valueText, valueError, editTitle, editBody, editNote, editValueText, editValueType, editOutputType,
        editTags, editCriteria, editComplexity,
        editMeta, editSchedule,
        editSuccess, editStatus, unlinkChat, templates, templatePath, pickTemplate: setTemplatePath,
    }), [readOnly, title, body, note, valueText, valueError, editTitle, editBody, editNote, editValueText, editValueType, editOutputType,
        editTags, editCriteria, editComplexity,
        editMeta, editSchedule,
        editSuccess, editStatus, unlinkChat, templates, templatePath]);

    return <FlowNodeEditingContext.Provider value={value}>{children}</FlowNodeEditingContext.Provider>;
};
