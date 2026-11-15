import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Tabs, type InputRef } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { extractName, markdownLinkDrop, parentPath, CodeMirrorTextEditor, ConfiguredMarkdown, Tooltip } from '@kiao-dashboard-core';
import { ImagePasteModal, insertBlockAt, markdownInlineKeymap, useImagePaste } from '@kiao-dashboard-kit/markdown-editor';
import { chains, isDisplay, isForAgent, isTask } from '../flowNodeType';
import { boardFolder } from '../boardRoute';
import { useHybridflow } from '../Hybridflow-ctx';
import { useFlowNodeEditing } from '../FlowNodeEditing-ctx';
import { useRunners } from '../Runners-ctx';
import { useFlowNodeArchive } from '../useFlowNodeArchive';
import { useOpenFlowNodeChat } from '../useOpenFlowNodeChat';
import { ComplexitySelect, FolderInput, RunnerSelect, SuccessCriteriaEditor, TagsControl, ValueTypeSelect } from './FlowNodeControls';
import { FlowNodeStatusMenu } from './FlowNodeStatusMenu';
import { resolvedValueSchema } from '../valueType';
import type { JsonSchema } from '@kiao-dashboard-kit/code-editor';
import { FlowNodeClassPanel } from './FlowNodeClassPanel';
import { FlowNodeMetaEditor } from './FlowNodeMetaEditor';
import { FlowNodeStateEditor } from './FlowNodeStateEditor';
import { FlowNodeSuccessEditor } from './FlowNodeSuccessEditor';
import { FlowNodeTemplateMenu } from './FlowNodeTemplateMenu';
import { FlowNodeValueEditor } from './FlowNodeValueEditor';
import { FlowNodeCosts } from './FlowNodeCosts';
import { FlowNodeOutputSelect, FlowNodeResultValue } from './FlowNodeOutput';
import styles from '../Hybridflow.module.css';
import { useChatAvailable } from '../useChatAvailable';

/** The panel box edits markdown, so it takes links by drop and formats at a keypress. */
const bodyExtensions: Extension = [markdownLinkDrop, markdownInlineKeymap];

/** Edits the selected node, with task spec and options in separate tabs. */
export const FlowNodePanel: React.FC = () => {
    const {
        content, handle, selectedFlowNode, selectedClass, titleCaret, takeTitleCaret,
    } = useHybridflow();
    const {
        readOnly, title, body, note, valueText, valueError, editTitle, editBody, editNote, editValueText, editValueType, editOutputType,
        editTags, editCriteria, editComplexity,
        editMeta, editSchedule, editSuccess, editStatus, unlinkChat,
    } = useFlowNodeEditing();
    const { runners } = useRunners();
    const harnessAvailable = useChatAvailable();
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

    const actions = (
        <div className={styles.panelHeader}>
            {!isDisplay(flowNode.type) && <FlowNodeStatusMenu status={flowNode.status} onChange={editStatus} />}
            {isTask(flowNode.type) && !readOnly && <FlowNodeTemplateMenu />}
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
        </div>
    );

    const titleInput = (
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
    );

    const options = (
        <>
            {harnessAvailable && (
                <FlowNodeMetaEditor
                    key={flowNode.id}
                    type={flowNode.type}
                    settings={flowNode.settings}
                    at={flowNode.at}
                    duration={flowNode.duration}
                    onChange={editMeta}
                    onSchedule={editSchedule}
                    readOnly={readOnly}
                    showFolder={!isTask(flowNode.type)}
                    showRunner={!isTask(flowNode.type)}
                />
            )}
            <FlowNodeStateEditor
                chat={flowNode.chat}
                showChat={harnessAvailable && isForAgent(flowNode.type)}
                onOpenChat={openChat}
                onUnlinkChat={unlinkChat}
            />
            {harnessAvailable && chains(flowNode.type) && (
                <FlowNodeSuccessEditor
                    success={flowNode.onSuccess}
                    content={content}
                    flowNodeId={flowNode.id}
                    type={flowNode.type}
                    settings={flowNode.settings}
                    onChange={editSuccess}
                    readOnly={readOnly}
                />
            )}

            {isTask(flowNode.type) && (
                <div className={styles.metaRow}>
                    <ComplexitySelect complexity={flowNode.complexity} onChange={editComplexity} />
                </div>
            )}
            <TagsControl tags={flowNode.tags} onChange={editTags} />
        </>
    );

    const spec = (
        <>
            {titleInput}
            {harnessAvailable && (
                <div className={styles.specLocation}>
                    {isForAgent(flowNode.type) && (
                        <RunnerSelect settings={flowNode.settings} runners={runners} onChange={editMeta} />
                    )}
                    <FolderInput settings={flowNode.settings} required={isForAgent(flowNode.type)} onChange={editMeta} disabled={readOnly} />
                </div>
            )}
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
            <div className={styles.metaRow}>
                <FlowNodeOutputSelect outputType={flowNode.outputType ?? ''} onChange={editOutputType} disabled={readOnly} />
            </div>
            <SuccessCriteriaEditor criteria={flowNode.criteria} onChange={editCriteria} readOnly={readOnly} />
        </>
    );

    const singleView = flowNode.type === 'note' ? (
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
    ) : <>{titleInput}{options}</>;

    return (
        <div className={`${styles.panel} ${styles.nodePanel}`} data-testid="flow-node-panel">
            {isTask(flowNode.type) ? (
                <Tabs
                    key={`${handle}/${flowNode.id}`}
                    className={styles.nodeViews}
                    size="small"
                    defaultActiveKey="spec"
                    tabBarExtraContent={actions}
                    items={[
                        { key: 'spec', label: 'Spec', children: <div className={styles.panel}>{spec}</div> },
                        { key: 'options', label: 'Options', children: <div className={styles.panel}>{options}</div> },
                        {
                            key: 'result', label: 'Result', destroyOnHidden: true,
                            children: (
                                <div className={styles.resultView}>
                                    {isForAgent(flowNode.type) && <FlowNodeCosts handle={handle} flowNodeId={flowNode.id} />}
                                    {flowNode.output === undefined
                                        ? <div className={styles.panelHint}>No result yet.</div>
                                        : <FlowNodeResultValue output={flowNode.output} />}
                                </div>
                            ),
                        },
                    ]}
                />
            ) : <>{actions}{singleView}</>}
            <ImagePasteModal {...imagePaste.modalProps} />
        </div>
    );
};
