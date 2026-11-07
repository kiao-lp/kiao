import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, type InputRef } from 'antd';
import { DeleteOutlined, ExpandAltOutlined, InboxOutlined } from '@ant-design/icons';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { extractName, markdownLinkDrop, parentPath, CodeMirrorTextEditor, ConfiguredMarkdown, Tooltip, useToolBars } from '@cms-core';
import { ImagePasteModal, insertBlockAt, markdownInlineKeymap, useImagePaste } from '@cms-kit/markdown-editor';
import { chains, isForAgent, isTask } from '../flowNodeType';
import { boardFolder } from '../boardRoute';
import { BOARD_TAB_ID } from '../constants';
import { useHybridflow } from '../Hybridflow-ctx';
import { useFlowNodeEditing } from '../FlowNodeEditing-ctx';
import { useFlowNodeArchive } from '../useFlowNodeArchive';
import { useFlowNodeDelete } from '../useFlowNodeDelete';
import { useOpenFlowNodeChat } from '../useOpenFlowNodeChat';
import { ComplexitySelect, SuccessCriteriaEditor, TagsControl, ValueTypeSelect } from './FlowNodeControls';
import { resolvedValueSchema } from '../valueType';
import type { JsonSchema } from '@cms-kit/code-editor';
import { FlowNodeClassPanel } from './FlowNodeClassPanel';
import { FlowNodeMetaEditor } from './FlowNodeMetaEditor';
import { FlowNodeStateEditor } from './FlowNodeStateEditor';
import { FlowNodeSuccessEditor } from './FlowNodeSuccessEditor';
import { FlowNodeTemplateSelect } from './FlowNodeTemplateSelect';
import { FlowNodeValueEditor } from './FlowNodeValueEditor';
import { FlowNodeOutput, FlowNodeOutputSelect, FlowNodeOutputValue } from './FlowNodeOutput';
import styles from '../Hybridflow.module.css';
import { useChatAvailable } from '../useChatAvailable';

/** The panel box edits markdown, so it takes links by drop and formats at a keypress. */
const bodyExtensions: Extension = [markdownLinkDrop, markdownInlineKeymap];

/** The open flow node: its title in a box of its own, its **description** in an editor under it,. */
export const FlowNodePanel: React.FC = () => {
    const {
        content, handle, selectedFlowNode, selectedClass, setExpanded, titleCaret, takeTitleCaret,
    } = useHybridflow();
    const {
        readOnly, title, body, note, valueText, valueError, editTitle, editBody, editNote, editValueText, editValueType, editOutputType,
        editTags, editCriteria, editComplexity,
        editMeta, editSchedule, editSuccess, editStatus, unlinkChat,
    } = useFlowNodeEditing();
    const agentAvailable = useChatAvailable();
    const toolBars = useToolBars();
    const deleteFlowNode = useFlowNodeDelete();
    const archiveFlowNodes = useFlowNodeArchive();
    const editorRef = useRef<HTMLDivElement>(null);

    const titleRef = useRef<InputRef>(null);

    const [bodyEditor, setBodyEditor] = useState<EditorView | null>(null);

    const flowNode = selectedFlowNode?.flowNode ?? null;


    const openChat = useOpenFlowNodeChat(flowNode?.chat ?? '');


    const insertImage = (snippet: string) => {
        if (readOnly) return;
        if (bodyEditor) {
            insertBlockAt(bodyEditor, snippet);
            return;
        }
        const held = body.replace(/\s+$/, '');
        editBody(held ? `${held}\n\n${snippet}` : snippet);
    };

    const imagePaste = useImagePaste(
        handle ? boardFolder(handle) : '', handle || 'flowNode', insertImage, true);


    useEffect(() => {
        if (!flowNode || titleCaret !== flowNode.id) return;
        takeTitleCaret();
        titleRef.current?.focus();
    }, [flowNode, titleCaret, takeTitleCaret]);

    if (selectedClass && !selectedFlowNode) {
        return <FlowNodeClassPanel />;
    }

    if (!selectedFlowNode || !flowNode || !content) {
        return <div className={styles.panelHint}>Select a node on the board to edit it.</div>;
    }

    return (
        <div className={`${styles.panel} ${styles.nodePanel}`} data-testid="flow-node-panel">
            <div className={styles.panelHeader}>
                <Tooltip title="Open in large editor">
                    <Button
                        size="small"
                        type="text"
                        icon={<ExpandAltOutlined />}
                        aria-label="Open in large editor"
                        data-testid="expand-flow-node"
                        onClick={() => {
                            setExpanded(true);
                            toolBars.showTab(BOARD_TAB_ID);
                        }}
                    />
                </Tooltip>

                <Tooltip title="Archive — the node leaves the board but stays stored">
                    <Button
                        size="small"
                        type="text"
                        icon={<InboxOutlined />}
                        aria-label="Archive node"
                        data-testid="archive-flow-node"
                        onClick={() => archiveFlowNodes([flowNode.id])}
                    />
                </Tooltip>
                {/* The board's own delete, dialog and all: it also asks whether the flow node's chat goes with it where this is the last. */}
                <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label="Delete node"
                    data-testid="delete-flow-node"
                    onClick={() => deleteFlowNode([flowNode.id])}
                />
            </div>
            {flowNode.type === 'note' ? (
                <div
                    className={styles.panelEditor}
                    ref={editorRef}
                    onPasteCapture={imagePaste.onPasteCapture}
                >
                    <CodeMirrorTextEditor
                        value={note}
                        onChange={editNote}
                        onEditor={setBodyEditor}
                        extensions={bodyExtensions}
                    />
                </div>
            ) : flowNode.type === 'value' ? (
                <>
                    <Input
                        ref={titleRef}
                        size="small"
                        className={styles.panelTitle}
                        value={title}
                        placeholder="Value title"
                        aria-label="Value title"
                        data-testid="flow-node-title"
                        onChange={event => editTitle(event.target.value)}
                    />
                    <div className={styles.metaRow}>
                        <ValueTypeSelect
                            valueType={flowNode.valueType}
                            content={content}
                            flowNodeId={flowNode.id}
                            onChange={editValueType}
                        />
                    </div>
                    <FlowNodeValueEditor
                        key={flowNode.id}
                        value={valueText}
                        onChange={editValueText}
                        error={valueError}
                        testId="flow-node-value"
                        schema={resolvedValueSchema(content, flowNode) as JsonSchema | undefined}
                    />
                </>
            ) : (
            <>
            <Input
                ref={titleRef}
                size="small"
                className={styles.panelTitle}
                value={title}
                placeholder="Node title"
                aria-label="Node title"
                data-testid="flow-node-title"
                onChange={event => editTitle(event.target.value)}
            />

            <TagsControl tags={flowNode.tags} onChange={editTags} />
            <FlowNodeStateEditor
                status={flowNode.status}
                chat={flowNode.chat}
                showChat={agentAvailable && isForAgent(flowNode.type)}
                onStatus={editStatus}
                onOpenChat={openChat}
                onUnlinkChat={unlinkChat}
            />
            {agentAvailable && (
                <>
                    <FlowNodeMetaEditor
                        key={flowNode.id}
                        type={flowNode.type}
                        settings={flowNode.settings}
                        at={flowNode.at}
                        duration={flowNode.duration}
                        onChange={editMeta}
                        onSchedule={editSchedule}
                        readOnly={readOnly}
                    />

                    {chains(flowNode.type) && (
                        <FlowNodeSuccessEditor
                            success={flowNode.onSuccess}
                            content={content}
                            flowNodeId={flowNode.id}
                            type={flowNode.type}
                            settings={flowNode.settings}
                            onChange={editSuccess}
                            readOnly={readOnly}
                            outputTypeSelect={isTask(flowNode.type) && (
                                <FlowNodeOutputSelect outputType={flowNode.outputType ?? ''} onChange={editOutputType} disabled={readOnly} />
                            )}
                        />
                    )}
                </>
            )}
            {isTask(flowNode.type) && (agentAvailable
                ? <FlowNodeOutputValue output={flowNode.output} />
                : <FlowNodeOutput outputType={flowNode.outputType ?? ''} output={flowNode.output} onChange={editOutputType} disabled={readOnly} />
            )}

            {isTask(flowNode.type) && (
                <>
                    <div className={styles.metaRow}>
                        <ComplexitySelect complexity={flowNode.complexity} onChange={editComplexity} />
                    </div>
                    {!readOnly && <FlowNodeTemplateSelect />}
                    <div
                        className={styles.panelEditor}
                        ref={editorRef}
                        onPasteCapture={readOnly ? undefined : imagePaste.onPasteCapture}
                    >
                        {readOnly ? (
                            <ConfiguredMarkdown className={styles.descriptionPreview} documentFolder="">{body}</ConfiguredMarkdown>
                        ) : (
                            <CodeMirrorTextEditor
                                value={body}
                                onChange={editBody}
                                onEditor={setBodyEditor}
                                extensions={bodyExtensions}
                            />
                        )}
                    </div>
                    <SuccessCriteriaEditor criteria={flowNode.criteria} onChange={editCriteria} readOnly={readOnly} />
                </>
            )}
            </>
            )}
            <ImagePasteModal {...imagePaste.modalProps} />
        </div>
    );
};
