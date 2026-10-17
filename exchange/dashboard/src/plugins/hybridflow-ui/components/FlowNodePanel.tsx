import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, type InputRef } from 'antd';
import { DeleteOutlined, ExpandAltOutlined, InboxOutlined } from '@ant-design/icons';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { extractName, markdownLinkDrop, parentPath, CodeMirrorTextEditor, Tooltip } from '@cms-core';
import { ImagePasteModal, insertBlockAt, markdownInlineKeymap, useImagePaste } from '@cms-kit/markdown-editor';
import { chains, isForAgent, isTask } from '../flowNodeType';
import { boardFolder } from '../boardRoute';
import { useHybridflow } from '../Hybridflow-ctx';
import { useFlowNodeEditing } from '../FlowNodeEditing-ctx';
import { useFlowNodeArchive } from '../useFlowNodeArchive';
import { useFlowNodeDelete } from '../useFlowNodeDelete';
import { useOpenFlowNodeChat } from '../useOpenFlowNodeChat';
import { ComplexitySelect, SuccessCriteriaEditor, TagsControl } from './FlowNodeControls';
import { FlowNodeClassPanel } from './FlowNodeClassPanel';
import { FlowNodeMetaEditor } from './FlowNodeMetaEditor';
import { FlowNodeStateEditor } from './FlowNodeStateEditor';
import { FlowNodeSuccessEditor } from './FlowNodeSuccessEditor';
import { FlowNodeTemplateSelect } from './FlowNodeTemplateSelect';
import styles from '../Hybridflow.module.css';
import { useChatAvailable } from '../useChatAvailable';

/** The panel box edits markdown, so it takes links by drop and formats at a keypress. */
const bodyExtensions: Extension = [markdownLinkDrop, markdownInlineKeymap];

/**
 * The open flow node: its title in a box of its own, its **description** in an editor under it, and its
 * settings above. Each is a field of the flow node in the content document, so what is typed is written
 * where it belongs rather than into a section of markdown that has to be parsed back apart.
 *
 * The description is ordinary markdown with nothing barred from it — headings included, which a flow node
 * could not hold while a column was one markdown file and a flow node one of its sections. It is what is
 * sent when the flow node is played, and a play leaves it exactly where it is: what the turn said is in
 * the conversation the card names.
 *
 * It is drawn for a **task** and for nothing else — an AI card or a Human card, which is to say a
 * card that is work somebody does. A Shutdown and a Scheduler describe no work: playing one *is*
 * what it does, so there is nothing to describe, and the store keeps no description for a card that
 * is not a task.
 *
 * Above them are the two things a play writes onto a flow node that are not its text: where it stands,
 * and which chat it is played in — the chat on an **AI** flow node alone, a card a person does having no
 * conversation to link to.
 *
 * What the panel draws is what the card's kind asks for — and the kind itself is not asked: it
 * was decided when the card was made, the canvas menu picking a kind rather than a name. A *Human*
 * card is a title, a description, a folder, its tags, where it stands and what comes after it; the
 * agent, the effort, the permission mode, the chat and the transition mode are not drawn for it at
 * all. A *Scheduler* is asked for a datetime and for the flow node it hands on to, and a *Shutdown*
 * for nothing — playing it is the whole of what it does, so neither the description nor the line
 * about what comes after it is drawn.
 *
 * A flow node too long for the toolbar's width opens in `ExpandedFlowNode`, over the central area, with the
 * preview a markdown file gets. It is the same flow node there, written through the same calls — one
 * draft of it, held by `FlowNodeEditing-ctx` above both — and the same controls, `FlowNodeControls`' own,
 * stacked here in a panel's width and laid across rows there. Neither of the two faces holds the
 * other: this panel is a tool-bar tab, and hiding the right column must not close an editor filling
 * the middle of the screen.
 *
 * Whether that editor is open is the board's state rather than the panel's, because the board
 * opens it too: a card double-clicked goes straight there, without a look at the panel first.
 *
 * Both faces of the body take a file dragged in from the file tree as a **markdown link** to it: a
 * flow node is mostly about files, and naming one by hand is copying a path across the window.
 *
 * Between the settings and the description is the **template** the description is written from:
 * one of the store's `.temp.md` flow node templates, picked in a select and instantiated with the button
 * beside it. Typing the card picks the one that goes with it; the large editor shows the same pick,
 * the two faces sharing one draft.
 *
 * Both also take a **pasted image**, saved into the board's own folder and linked from the body
 * from the store root — the same dialog every markdown editor here opens. A screenshot is half of
 * what a flow node about a screen is, and it is pasted into whichever of the two boxes is in front
 * of the user, so neither of them may be the one that swallows it. What a played flow node then
 * hands its turn is that file of the store, named where it really is (worker's
 * `flow_node_images.go`).
 */
export const FlowNodePanel: React.FC = () => {
    const {
        content, handle, selectedFlowNode, selectedClass, setExpanded, titleCaret, takeTitleCaret,
    } = useHybridflow();
    const {
        title, body, editTitle, editBody, editTags, editCriteria, editComplexity,
        editMeta, editSchedule, editSuccess, editStatus, unlinkChat,
    } = useFlowNodeEditing();
    const agentAvailable = useChatAvailable();
    const deleteFlowNode = useFlowNodeDelete();
    const archiveFlowNode = useFlowNodeArchive();
    const editorRef = useRef<HTMLDivElement>(null);
    /** The title's box, from the moment it is on screen. */
    const titleRef = useRef<InputRef>(null);
    /** The body's editor, from the moment CodeMirror has made one under the panel's box. */
    const [bodyEditor, setBodyEditor] = useState<EditorView | null>(null);

    const flowNode = selectedFlowNode?.flowNode ?? null;

    /** The flow node's chat, in the panel it is watched in — the one thing that can put one on screen. */
    const openChat = useOpenFlowNodeChat(flowNode?.chat ?? '');

    /**
     * Where a pasted image lands: at the caret, through the editor's own document, so the paste is
     * one undo step and the caret stays after it. The fallback is the end of the body, for a paste
     * that reached the panel with no editor under it — nothing else would be honest about a file
     * that has already been written to the store.
     */
    const insertImage = (snippet: string) => {
        if (bodyEditor) {
            insertBlockAt(bodyEditor, snippet);
            return;
        }
        const held = body.replace(/\s+$/, '');
        editBody(held ? `${held}\n\n${snippet}` : snippet);
    };

    // The image goes into the **board's own folder** (`boardFolder`, boardRoute.ts) — a folder named
    // after the board's handle, not its title, so renaming the board does not orphan the images its
    // cards already link to. Its link is written from the store root all the same: a card is held in
    // a database row, not a document, so there is no folder for a relative link to resolve against —
    // neither the turn the body is sent to nor the preview stands in the board's folder.
    const imagePaste = useImagePaste(
        handle ? boardFolder(handle) : '', handle || 'flowNode', insertImage, true);

    /**
     * A card made on the canvas arrives untitled — the menu picked a kind, not a name —
     * so the panel it opens takes the focus into the title, with nothing to select: the next
     * keystroke names it, for a card that was only ever a kind, without a click first.
     *
     * Done from here rather than by the input's `autoFocus`, which fires on a mount alone: the
     * panel is as often already on screen, showing the flow node before this one, and nothing mounts
     * when the new one arrives in it. The board is asked whose focus it is, because a panel opened
     * by any other gesture — a card clicked, the tab picked from the menu — must not steal it.
     */
    useEffect(() => {
        if (!flowNode || titleCaret !== flowNode.id) return;
        takeTitleCaret();
        titleRef.current?.focus();
    }, [flowNode, titleCaret, takeTitleCaret]);

    // The opening is a class, not a card: the class panel edits it, with its versions
    // beneath it. The tab is one tab for both — the board's opening is one opening.
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
                        onClick={() => setExpanded(true)}
                    />
                </Tooltip>
                {/* The other way off the board, beside the delete: the card stays stored
                    with `archived` set, hidden everywhere with its links. */}
                <Tooltip title="Archive — the node leaves the board but stays stored">
                    <Button
                        size="small"
                        type="text"
                        icon={<InboxOutlined />}
                        aria-label="Archive node"
                        data-testid="archive-flow-node"
                        onClick={() => archiveFlowNode(flowNode.id)}
                    />
                </Tooltip>
                {/* The board's own delete, dialog and all: it also asks whether the flow node's chat
                    goes with it where this is the last card naming one. The one flow node open here,
                    never the board's marked cards — the panel is an editor of this flow node, and what
                    is picked out on the board behind it is the board's business. */}
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
            {/* Under the title, which is what they are about: a tag says what the flow node is, not
                what plays it, so it sits with the words rather than among the settings. */}
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
                    />
                    {/* Not drawn on a Shutdown, which is asked neither: nothing is played after
                        the machine goes off, so there is no chain and no conversation to hand
                        on. */}
                    {chains(flowNode.type) && (
                        <FlowNodeSuccessEditor
                            success={flowNode.onSuccess}
                            content={content}
                            flowNodeId={flowNode.id}
                            type={flowNode.type}
                            settings={flowNode.settings}
                            onChange={editSuccess}
                        />
                    )}
                </>
            )}
            {/* The description, and what it is written from: a template of the store, and the button
                that instantiates it into the box below. Drawn for a **task** and for nothing else —
                a Shutdown and a Scheduler describe no work, so there is nothing to ask of them and
                nowhere for an answer to be kept. It is drawn whatever the deployment can play: a
                card somebody does themselves is written from a template like any other. Above it,
                how heavy it looks — the task's own, drawn for a task and for nothing else either.
                What done means sits below the description, so the box that grows is the body. */}
            {isTask(flowNode.type) && (
                <>
                    <div className={styles.metaRow}>
                        <ComplexitySelect complexity={flowNode.complexity} onChange={editComplexity} />
                    </div>
                    <FlowNodeTemplateSelect />
                    <div
                        className={styles.panelEditor}
                        ref={editorRef}
                        onPasteCapture={imagePaste.onPasteCapture}
                    >
                        <CodeMirrorTextEditor
                            value={body}
                            scrollMemoryKey={null}
                            onChange={editBody}
                            onEditor={setBodyEditor}
                            extensions={bodyExtensions}
                        />
                    </div>
                    <SuccessCriteriaEditor criteria={flowNode.criteria} onChange={editCriteria} />
                </>
            )}
            <ImagePasteModal {...imagePaste.modalProps} />
        </div>
    );
};
