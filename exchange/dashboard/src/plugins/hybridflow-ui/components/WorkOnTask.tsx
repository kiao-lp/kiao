import React, { useEffect, useState } from 'react';
import { Button, Input } from 'antd';
import { ConfiguredMarkdown, useCentralStack } from '@cms-core';
import { getLanguageService, TextDocument, DiagnosticSeverity } from 'vscode-json-languageservice';
import type { JsonSchema } from '@cms-kit/code-editor';
import { useHybridflow } from '../Hybridflow-ctx';
import { useHybridflowClient } from '../service/HybridflowClient-ctx';
import type { SchemaValueDto } from '../service/types';
import type { BoardContent, FlowNode } from '../boardContent';
import { BOARD_TAB_ID } from '../constants';
import { FlowNodeValueEditor } from './FlowNodeValueEditor';
import styles from '../Hybridflow.module.css';

export const WorkOnTaskHost: React.FC = () => {
    const { content, working, setWorking } = useHybridflow();
    const { push, close } = useCentralStack();
    const openId = React.useRef<string | null>(null);

    useEffect(() => {
        if (openId.current && openId.current !== working) close(workPanelId(openId.current));
        openId.current = working;
        if (!working) return;
        const flowNode = content?.flowNodes.find(node => node.id === working);
        if (!flowNode) return;
        push({
            id: workPanelId(working),
            host: BOARD_TAB_ID,
            label: flowNode.title || 'Work on task',
            closeLabel: 'Close',
            onClose: () => setWorking(null),
            content: <WorkOnTask flowNodeId={working} />,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [working]);

    useEffect(() => () => { if (openId.current) close(workPanelId(openId.current)); }, [close]);
    return null;
};

export const workPanelId = (flowNodeId: string): string => `work-on-task-${flowNodeId}`;

export const parseHumanOutput = (text: string, outputType: string): { value: unknown } | { error: string } => {
    if (!outputType) return { value: text };
    try {
        return { value: JSON.parse(text) as unknown };
    } catch {
        return { error: 'Invalid JSON' };
    }
};

export const successorToTodo = (content: BoardContent, flowNode: FlowNode): string | null => {
    const nextId = flowNode.onSuccess.flowNode;
    if (!nextId) return null;
    const next = content.flowNodes.find(node => node.id === nextId);
    if (!next || next.archived || next.type !== 'human') return null;
    if (next.status === 'done' || next.status === 'todo' || next.status === 'running') return null;
    return next.id;
};

const validateAgainstSchema = async (text: string, schema: unknown): Promise<string> => {
    const service = getLanguageService({
        clientCapabilities: {
            textDocument: { completion: { completionItem: { documentationFormat: ['plaintext'] } } },
        },
    });
    const schemaObject = typeof schema === 'boolean' ? (schema ? {} : { not: {} }) : schema as JsonSchema;
    service.configure({
        validate: true,
        allowComments: false,
        schemas: [{ uri: 'inmemory://kiao/work.schema.json', fileMatch: ['*'], schema: schemaObject as object }],
    });
    const document = TextDocument.create('inmemory://kiao/work.json', 'json', 0, text);
    const parsed = service.parseJSONDocument(document);
    const diagnostics = await service.doValidation(document, parsed, {
        comments: 'error', trailingCommas: 'error', schemaValidation: 'error',
    });
    const error = diagnostics.find(item => item.severity === DiagnosticSeverity.Error);
    return error ? error.message : '';
};

export const WorkOnTask: React.FC<{ flowNodeId: string }> = ({ flowNodeId }) => {
    const { content, editFlowNode, setWorking } = useHybridflow();
    const client = useHybridflowClient();
    const flowNode = content?.flowNodes.find(node => node.id === flowNodeId) ?? null;
    const typed = !!flowNode?.outputType;
    const [text, setText] = useState('');
    const [error, setError] = useState('');
    const [schemas, setSchemas] = useState<SchemaValueDto[]>([]);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!flowNode) return;
        if (flowNode.output === undefined) {
            setText('');
        } else if (flowNode.outputType) {
            setText(JSON.stringify(flowNode.output, null, 2));
        } else {
            setText(typeof flowNode.output === 'string' ? flowNode.output : JSON.stringify(flowNode.output, null, 2));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flowNodeId]);

    useEffect(() => {
        if (!client || !typed) return;
        let cancelled = false;
        client.schemaValues()
            .then(list => { if (!cancelled) setSchemas(list); })
            .catch(() => { if (!cancelled) setSchemas([]); });
        return () => { cancelled = true; };
    }, [client, typed]);

    if (!flowNode || !content) {
        return <div className={styles.panelHint}>Task not found.</div>;
    }

    const schema = schemas.find(item => item.id === flowNode.outputType);

    const submit = async () => {
        setError('');
        const parsed = parseHumanOutput(text, flowNode.outputType ?? '');
        if ('error' in parsed) {
            setError(parsed.error);
            return;
        }
        if (typed) {
            if (!schema) {
                setError('Unavailable output schema');
                return;
            }
            const problem = await validateAgainstSchema(text, schema.value);
            if (problem) {
                setError(problem);
                return;
            }
        }
        setSubmitting(true);
        try {
            editFlowNode(flowNode.id, { output: parsed.value, status: 'done' });
            const nextId = successorToTodo(content, flowNode);
            if (nextId) editFlowNode(nextId, { status: 'todo' });
            setWorking(null);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className={styles.panel} data-testid="work-on-task">
            <div>{flowNode.title || 'Untitled'}</div>
            {flowNode.body
                ? <ConfiguredMarkdown documentFolder="">{flowNode.body}</ConfiguredMarkdown>
                : null}
            {flowNode.criteria.length > 0 && (
                <ul data-testid="work-on-task-criteria">
                    {flowNode.criteria.map(criterion => <li key={criterion.id}>{criterion.text}</li>)}
                </ul>
            )}
            {typed ? (
                <FlowNodeValueEditor
                    value={text}
                    onChange={setText}
                    error=""
                    testId="work-on-task-output"
                    schema={schema?.value as JsonSchema | undefined}
                />
            ) : (
                <Input.TextArea
                    value={text}
                    onChange={event => setText(event.target.value)}
                    aria-label="Output"
                    data-testid="work-on-task-output"
                    autoSize={{ minRows: 6 }}
                />
            )}
            {error && <div role="alert" data-testid="work-on-task-error">{error}</div>}
            <Button
                type="primary"
                loading={submitting}
                onClick={() => void submit()}
                data-testid="work-on-task-submit"
            >
                Submit
            </Button>
        </div>
    );
};
