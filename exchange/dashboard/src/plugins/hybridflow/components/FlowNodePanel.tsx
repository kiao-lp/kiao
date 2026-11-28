import React, { useEffect, useRef, useState } from 'react';
import { Input, Tabs, type InputRef } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { InboxOutlined } from '@ant-design/icons';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { IconButton, useDashboardConfig, extractName, markdownLinkDrop, markdownLinkDropHandlers, parentPath, CodeMirrorTextEditor, ConfiguredMarkdown, VoiceInputButton } from '@kiao-dashboard-core';
import { ImagePasteModal, insertBlockAt, markdownInlineKeymap, useImagePaste } from '@kiao-dashboard-kit/markdown-editor';
import { flowNodeInput } from '../boardContent';
import { hasContextReference, renderNodeContext, roleValues } from '../nodeContext';
import { chains, isBitbucketEvent, isDisplay, isForAgent, isTask } from '../flowNodeType';
import { boardFolder } from '../boardRoute';
import { useHybridflow } from '../Hybridflow-ctx';
import { useFlowNodeEditing } from '../FlowNodeEditing-ctx';
import { useRunners } from '../Runners-ctx';
import { useFlowNodeArchive } from '../useFlowNodeArchive';
import { useShowChat } from '../conversations/ChatShow-ctx';
import { ComplexitySelect, FolderInput, RunnerSelect, SuccessCriteriaEditor, TagsControl, ValueTypeSelect } from './FlowNodeControls';
import { FlowNodeStatusMenu } from './FlowNodeStatusMenu';
import { resolvedValueSchema } from '../valueType';
import type { JsonSchema } from '@kiao-dashboard-kit/code-editor';
import { FlowNodeMetaEditor } from './FlowNodeMetaEditor';
import { FlowNodeStateEditor } from './FlowNodeStateEditor';
import { FlowNodeSuccessEditor } from './FlowNodeSuccessEditor';
import { BitbucketStatusEditor } from './BitbucketStatusEditor';
import { ExclusiveGatewayRoutes } from './ExclusiveGatewayRoutes';
import { LimiterEditor } from './LimiterEditor';
import { RoleEditor } from './RoleEditor';
import { DescriptionTemplateEditor } from './DescriptionTemplateEditor';
import { DescriptionTemplateSwitch } from './DescriptionTemplateSwitch';
import { FlowNodeTemplateMenu } from './FlowNodeTemplateMenu';
import { FlowNodeValueEditor } from './FlowNodeValueEditor';
import { FlowNodeCosts } from './FlowNodeCosts';
import { TaskExecutions } from './TaskExecutions';
import { FlowNodeOutputSelect, FlowNodeResultValue } from './FlowNodeOutput';
import styles from '../Hybridflow.module.css';

/** The note editor edits markdown, so it takes links by drop and formats at a keypress. */
const bodyExtensions: Extension = [markdownLinkDrop, markdownInlineKeymap];

/** A block on lines of its own, at the caret of a plain text box. */
const blockAtCaret = (box: HTMLTextAreaElement | null, value: string, block: string) => {
    const at = Math.min(box?.selectionStart ?? value.length, value.length);
    const to = Math.min(box?.selectionEnd ?? at, value.length);
    const before = value.slice(0, at);
    const lead = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    return { value: `${before}${lead}${block}${value.slice(to)}`, caret: at + lead.length + block.length };
};

/** Edits the selected node, with task spec and options in separate tabs. */
export const FlowNodePanel: React.FC = () => {
    const {
        content, handle, openingId, selectedFlowNode, titleCaret, takeTitleCaret, editFlowNode,
    } = useHybridflow();
    const {
        readOnly, title, body, note, valueText, valueError, editTitle, editBody, editNote, editValueText, editValueType, editOutputType,
        editTags, editCriteria, editComplexity,
        editMeta, editSchedule, editSuccess, editStatus, unlinkChat,
    } = useFlowNodeEditing();
    const { runners } = useRunners();
    const { chatEnabled: harnessAvailable } = useDashboardConfig();
    const archiveFlowNodes = useFlowNodeArchive();

    const titleRef = useRef<InputRef>(null);
    const descriptionRef = useRef<TextAreaRef>(null);

    const [bodyEditor, setBodyEditor] = useState<EditorView | null>(null);

    const flowNode = selectedFlowNode?.flowNode ?? null;

    const showChat = useShowChat();

    const insertImage = (snippet: string) => {
        if (readOnly) return;
        if (flowNode?.type === 'note' && bodyEditor) {
            insertBlockAt(bodyEditor, snippet);
            return;
        }
        const box = descriptionRef.current?.resizableTextArea?.textArea ?? null;
        const held = blockAtCaret(box, body, snippet);
        editBody(held.value);
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                box?.focus();
                box?.setSelectionRange(held.caret, held.caret);
            });
        }
    };

    const imagePaste = useImagePaste(
        handle ? boardFolder(handle) : '', handle || 'flowNode', insertImage, true);

    useEffect(() => {
        if (!flowNode || titleCaret !== flowNode.id) return;
        takeTitleCaret();
        titleRef.current?.focus();
    }, [flowNode, titleCaret, takeTitleCaret]);

    if (!selectedFlowNode || !flowNode || !content) {
        return <div className={styles.panelHint}>Select a node on the board to edit it.</div>;
    }

    const task = isTask(flowNode.type);
    const multiPartTemplate = task && flowNode.multiPartTemplate;
    const actions = (
        <div className={styles.panelHeader}>
            {!isDisplay(flowNode.type) && <FlowNodeStatusMenu status={flowNode.status} onChange={editStatus} />}
            {task && (
                <DescriptionTemplateSwitch
                    key={`${openingId}/${flowNode.id}`}
                    body={body} checked={multiPartTemplate} disabled={readOnly}
                    onChange={edit => editFlowNode(flowNode.id, edit)}
                />
            )}
            {task && !readOnly && !multiPartTemplate && <FlowNodeTemplateMenu />}
            <IconButton
                label="Archive node"
                tooltip="Archive — the node leaves the board but stays stored"
                icon={<InboxOutlined />}
                data-testid="archive-flow-node"
                onClick={() => archiveFlowNodes([flowNode.id])}
            />
        </div>
    );

    const titleLabel = flowNode.type === 'role' ? 'Role name' : 'Flow node title';
    const titleInput = (
        <Input
            ref={titleRef}
            size="small"
            className={styles.panelTitle}
            value={title}
            placeholder={titleLabel}
            aria-label={titleLabel}
            data-testid="flow-node-title"
            onChange={event => editTitle(event.target.value)}
        />
    );

    const bitbucketEvent = isBitbucketEvent(flowNode.type);
    const options = (
        <>
            {harnessAvailable && !bitbucketEvent && (
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
            {bitbucketEvent && (
                <BitbucketStatusEditor
                    key={`${flowNode.id}:${flowNode.type}`}
                    node={flowNode}
                    onChange={edit => editFlowNode(flowNode.id, edit)}
                    disabled={readOnly}
                />
            )}
            <FlowNodeStateEditor
                chat={flowNode.chat}
                showChat={harnessAvailable && isForAgent(flowNode.type)}
                onOpenChat={() => showChat(flowNode.chat ?? '')}
                onUnlinkChat={unlinkChat}
            />
            {flowNode.type !== 'limiter' && (harnessAvailable || flowNode.type === 'exclusive-gateway' || bitbucketEvent) && chains(flowNode.type) && (
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
            {flowNode.type === 'exclusive-gateway' && (
                <ExclusiveGatewayRoutes
                    key={flowNode.id}
                    node={flowNode}
                    content={content}
                    readOnly={readOnly}
                    onChange={routes => editFlowNode(flowNode.id, { routes })}
                />
            )}
            {flowNode.type === 'limiter' && (
                <LimiterEditor
                    key={flowNode.id}
                    node={flowNode}
                    content={content}
                    readOnly={readOnly}
                    onChange={edit => editFlowNode(flowNode.id, edit)}
                />
            )}

            {task && (
                <div className={styles.metaRow}>
                    <ComplexitySelect complexity={flowNode.complexity} onChange={editComplexity} />
                </div>
            )}
            <TagsControl tags={flowNode.tags} onChange={editTags} />
            {handle && isForAgent(flowNode.type) && <TaskExecutions handle={handle} id={flowNode.id} refreshKey={flowNode.status ?? ''} />}
        </>
    );

    const context = hasContextReference(flowNode.settings.folder ?? '') || (readOnly && hasContextReference(body))
        ? {
            input: flowNodeInput(content, flowNode),
            workflow: content.workflows.find(item => item.id === flowNode.workflow),
            roles: roleValues(content.flowNodes),
        }
        : undefined;
    const spec = (
        <>
            {titleInput}
            {harnessAvailable && (
                <div className={styles.specLocation}>
                    {isForAgent(flowNode.type) && (
                        <RunnerSelect settings={flowNode.settings} runners={runners} onChange={editMeta} />
                    )}
                    <FolderInput
                        settings={flowNode.settings}
                        required={isForAgent(flowNode.type)}
                        onChange={editMeta}
                        disabled={readOnly}
                        context={context}
                    />
                </div>
            )}
            <div
                className={multiPartTemplate && !readOnly
                    ? `${styles.panelEditor} ${styles.descriptionTemplate}` : styles.panelEditor}
                onPasteCapture={readOnly || multiPartTemplate ? undefined : imagePaste.onPasteCapture}
            >
                {readOnly ? (
                    <ConfiguredMarkdown className={styles.descriptionPreview} documentFolder="">
                        {context ? renderNodeContext(body, context) : body}
                    </ConfiguredMarkdown>
                ) : multiPartTemplate ? (
                    <DescriptionTemplateEditor body={body} onChange={editBody} />
                ) : (
                    <Input.TextArea
                        ref={descriptionRef}
                        className={styles.panelDescription}
                        style={{ height: '100%', resize: 'none' }}
                        variant="borderless"
                        value={body}
                        placeholder="What the task asks for"
                        aria-label="Task description"
                        data-testid="panel-source"
                        onChange={event => editBody(event.target.value)}
                        {...markdownLinkDropHandlers(body, editBody)}
                    />
                )}
            </div>
            <div className={styles.metaRow}>
                <FlowNodeOutputSelect outputType={flowNode.outputType ?? ''} onChange={editOutputType} disabled={readOnly} />
                {!readOnly && !multiPartTemplate && <VoiceInputButton value={body} onChange={editBody} />}
            </div>
            <SuccessCriteriaEditor criteria={flowNode.criteria} onChange={editCriteria} readOnly={readOnly} />
        </>
    );

    const singleView = flowNode.type === 'role' ? (
        <>
            {titleInput}
            <RoleEditor key={flowNode.id} node={flowNode} nodes={content.flowNodes}
                onChange={edit => editFlowNode(flowNode.id, edit)} />
        </>
    ) : flowNode.type === 'note' ? (
        <div
            className={styles.panelEditor}
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
            {task ? (
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
