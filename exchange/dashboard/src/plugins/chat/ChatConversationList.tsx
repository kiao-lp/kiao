// ── The conversation switcher ─────────────────────────────────────────────────
//
// The conversations the service holds, as one select. The list itself belongs to the caller — it is
// the registry's, kept fresh by the `conversation` frames every open socket receives — and the only
// thing this component fetches for itself is the live turn, read from the app-level runtime map.
//
// That map is why an option can show a dot without polling: a turn started in another tab reaches
// this one as frames, and a conversation the user has switched away from keeps accumulating,
// because the map outlives the panel.
//
// **One select rather than one row each.** A row per conversation costs the chat underneath a line
// of height for every conversation ever made, and the panel is a sidebar — so the titles are folded
// into a dropdown, and only the selected one keeps its row of actions. What is running is the one
// thing a fold would hide that matters, so it is counted back out beside the select.
//
// The row is still a component of its own, because it is the header of a pinned conversation's
// column: the title, the dot and the five actions are the same things whether the conversation is
// the one selected or the only one of a column, and a second rendering of them would be a second
// thing to keep true.

import React, { useState } from 'react';
import { Button, Input, Popconfirm, Select } from 'antd';
import { Tooltip } from '@cms-core';
import {
    DeleteOutlined, EditOutlined, InboxOutlined, PlusCircleOutlined, PlusOutlined,
    PlusSquareOutlined, PushpinFilled, PushpinOutlined,
} from '@ant-design/icons';
import type { AgentConversation, AgentOptionsEntry } from 'kiao-worker';
import { useChatSocketContext } from './ChatSocket-ctx';
import type { ConversationRuntime } from './chatConversationReducer';

/** How a folder reads in a sentence. `""` is the store root, which has no name of its own. */
const folderLabel = (folder: string): string => folder || 'the store root';

/** How a conversation reads on hover: what it is called, where it runs, how long it has been going. */
const conversationTitle = (conversation: AgentConversation): string =>
    `${conversation.title}\n${folderLabel(conversation.folder)} · ${conversation.messageCount} messages`;

/**
 * The runtime knows first for a conversation this tab watches; the record answers for the rest, and
 * both are live, so either saying "running" is enough to light the dot.
 */
const isRunning = (
    conversation: AgentConversation,
    runtimes: Record<string, ConversationRuntime>,
): boolean => runtimes[conversation.id]?.running || conversation.running;

/**
 * Only the lit dot carries a label: an idle conversation is the normal state, and a reader gains
 * nothing from being told so once per conversation.
 */
const ChatConversationDot: React.FC<{ running: boolean }> = ({ running }) => (
    <span
        className={`chat-conversation-dot${running ? ' chat-conversation-dot--running' : ''}`}
        role={running ? 'img' : undefined}
        aria-label={running ? 'A turn is running' : undefined}
    />
);

/**
 * What can be done to one conversation. The same four wherever the conversation is being shown
 * from — the select's bar, or a pinned column's header — so they are written once.
 *
 * **Forking is not among them, and that is deliberate.** A fork is asked of a *message* — see
 * `ChatMessageList` — because where a conversation branches is the whole of what a user is
 * choosing when they fork one, and a button up here can only ever mean "at the end". It sat here
 * while that was the only branch point the CLI could give us; it does not any more.
 */
const ChatConversationActions: React.FC<{
    conversation: AgentConversation;
    onStartRename: () => void;
    onTogglePin: () => void;
    onArchive: () => void;
    onDelete: () => void;
}> = ({ conversation, onStartRename, onTogglePin, onArchive, onDelete }) => (
    // The actions never select the conversation they sit beside.
    <span className="chat-conversation-actions" onClick={e => e.stopPropagation()}>
        <Tooltip title="Rename">
            <Button size="small" type="text" icon={<EditOutlined />} aria-label="Rename" onClick={onStartRename} />
        </Tooltip>
        {/* Pinning changes where the conversation is shown and nothing else — it is not a second
            kind of archiving, and a pinned conversation runs exactly like any other. */}
        <Tooltip title={conversation.pinned
            ? 'Unpin — put it back in the list'
            : 'Pin — give it a column of its own, beside the list'}>
            <Button
                size="small"
                type="text"
                icon={conversation.pinned ? <PushpinFilled /> : <PushpinOutlined />}
                aria-label={conversation.pinned ? 'Unpin' : 'Pin'}
                aria-pressed={conversation.pinned}
                onClick={onTogglePin}
            />
        </Tooltip>
        <Tooltip title="Archive — hides it here; the conversation and its transcript stay on the server">
            <Button size="small" type="text" icon={<InboxOutlined />} aria-label="Archive" onClick={onArchive} />
        </Tooltip>
        {/* Deleting drops the service's record and its transcript, and stops a turn running in it —
            the one action here nothing brings back. */}
        <Popconfirm
            title="Delete this conversation?"
            description="Its transcript goes with it."
            okText="Delete"
            okButtonProps={{ danger: true }}
            // The button is the last thing on a bar that ends at the panel's right edge, and the
            // panel is usually the window's: a box centred on the button hangs off the screen.
            // Hanging it from its right corner instead opens it inwards, over the chat.
            placement="topRight"
            onConfirm={onDelete}
        >
            <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="Delete" />
        </Popconfirm>
    </span>
);

/** The box a title is retyped in, in place of whatever was showing it. */
const AgentConversationRename: React.FC<{
    title: string;
    onDone: (title: string) => void;
    onCancel: () => void;
}> = ({ title, onDone, onCancel }) => {
    // The box starts on the current title rather than on whatever it held the last time something
    // was renamed.
    const [draft, setDraft] = useState(title);
    const finish = () => onDone(draft.trim());

    return (
        <Input
            className="chat-conversation-rename"
            size="small"
            value={draft}
            autoFocus
            onClick={e => e.stopPropagation()}
            onChange={e => setDraft(e.target.value)}
            // Emptying the box is not a rename to nothing: the service reads a blank title as "go
            // back to being named after the first prompt", which is what it looks like it should do.
            onPressEnter={finish}
            onBlur={finish}
            onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
        />
    );
};

export const ChatConversationRow: React.FC<{
    conversation: AgentConversation;
    active: boolean;
    /** Renders as a column's title bar rather than as one row among others. */
    header?: boolean;
    onSelect: () => void;
    onRename: (title: string) => void;
    onTogglePin: () => void;
    onArchive: () => void;
    onDelete: () => void;
}> = ({ conversation, active, header, onSelect, onRename, onTogglePin, onArchive, onDelete }) => {
    const { runtimes } = useChatSocketContext();
    const [renaming, setRenaming] = useState(false);

    const className = 'chat-conversation-row'
        + (active ? ' chat-conversation-row--active' : '')
        + (header ? ' chat-conversation-row--header' : '');

    return (
        <div className={className} onClick={onSelect} title={conversationTitle(conversation)}>
            <ChatConversationDot running={isRunning(conversation, runtimes)} />
            {renaming ? (
                <AgentConversationRename
                    title={conversation.title}
                    onDone={title => {
                        setRenaming(false);
                        if (title !== conversation.title) onRename(title);
                    }}
                    onCancel={() => setRenaming(false)}
                />
            ) : (
                <span className="chat-conversation-title">{conversation.title}</span>
            )}
            <ChatConversationActions
                conversation={conversation}
                onStartRename={() => setRenaming(true)}
                onTogglePin={onTogglePin}
                onArchive={onArchive}
                onDelete={onDelete}
            />
        </div>
    );
};

/**
 * The marks the starters are told apart by. All plainly a `+`, because what every one of them does
 * is the same thing — a conversation in the folder the browser is showing — and each drawn
 * differently, because two identical buttons side by side are two buttons nobody can choose between
 * without hovering first.
 *
 * By position rather than by engine: which agents a deployment offers is the *service's* answer, and
 * a client that drew a Codex mark would be a client that had to be edited before the next CLI could
 * be installed. The default agent comes first, so the starter that has always been a bare `+` still
 * is one. Past the third, agents share the last mark and are told apart by their tooltips alone.
 */
const STARTER_MARKS = [<PlusOutlined />, <PlusSquareOutlined />, <PlusCircleOutlined />];

const starterMark = (index: number): React.ReactNode =>
    STARTER_MARKS[Math.min(index, STARTER_MARKS.length - 1)];

/**
 * The switcher's title bar. It sits above the columns rather than inside one: "Conversations" names
 * the whole switcher, and the starters beside it make one in the folder the browser is showing,
 * whichever column the user is looking at.
 *
 * **One starter per agent, not one starter.** The agent is the single thing about a conversation
 * that can never be changed afterwards — a session id belongs to one engine — so it has to be
 * chosen *before* there is a conversation, and the select on the box below is disabled the moment
 * there is one. A single `+` therefore left the second engine unreachable from a panel that already
 * had a chat in it: it made one on whatever that box was showing, which is the open conversation's
 * own agent. A row of starters asks the question where it can still be answered.
 *
 * No agent offered is no starter: the panel says so in a banner of its own, and a button whose
 * first turn is refused would be a worse way to hear it.
 */
export const ChatConversationHead: React.FC<{
    folder: string;
    /** Every agent this deployment offers, the default first — one starter each. */
    agents: AgentOptionsEntry[];
    onCreate: (agent: string) => void;
}> = ({ folder, agents, onCreate }) => (
    <div className="chat-conversation-head">
        <span className="chat-conversation-head-label">Conversations</span>
        <span className="chat-conversation-head-starters">
            {agents.map((agent, index) => (
                // Naming the engine is the whole point of the tooltip: the marks say "new", and only
                // this says which of them this one is new *on*.
                <Tooltip
                    key={agent.value}
                    title={`New ${agent.label} conversation in ${folderLabel(folder)}`
                        + ' — a conversation keeps its agent for life'}
                >
                    <Button
                        size="small"
                        type="text"
                        icon={starterMark(index)}
                        aria-label={`New ${agent.label} conversation`}
                        onClick={() => onCreate(agent.value)}
                    />
                </Tooltip>
            ))}
        </span>
    </div>
);

/**
 * The conversations that share a column: the unpinned ones, picked from a select, with the chosen
 * one showing its chat underneath. Pinned conversations are not here — each has a column of its
 * own, headed by its own row.
 */
export const ChatConversationList: React.FC<{
    conversations: AgentConversation[];
    activeId: string | null;
    loading: boolean;
    onSelect: (id: string) => void;
    onRename: (id: string, title: string) => void;
    onTogglePin: (id: string) => void;
    onArchive: (id: string) => void;
    onDelete: (id: string) => void;
}> = ({ conversations, activeId, loading, onSelect, onRename, onTogglePin, onArchive, onDelete }) => {
    const { runtimes } = useChatSocketContext();
    const [renaming, setRenaming] = useState(false);

    const active = conversations.find(conversation => conversation.id === activeId) ?? null;

    const options = conversations.map(conversation => ({
        value: conversation.id,
        // `title` is both what a typed search matches and what the option says on hover, so the
        // dropdown answers "which of these is it" the way the rows used to.
        title: conversationTitle(conversation),
        label: (
            <span className="chat-conversation-option">
                <ChatConversationDot running={isRunning(conversation, runtimes)} />
                <span className="chat-conversation-title">{conversation.title}</span>
            </span>
        ),
    }));

    // A folded list still has to say that something is working in it: the dot of the conversation on
    // screen is visible, and every other one is a click away, so they are counted instead.
    const runningElsewhere = conversations
        .filter(conversation => conversation.id !== activeId && isRunning(conversation, runtimes))
        .length;

    return (
        <div className="chat-conversation-list">
            {renaming && active ? (
                <AgentConversationRename
                    title={active.title}
                    onDone={title => {
                        setRenaming(false);
                        if (title !== active.title) onRename(active.id, title);
                    }}
                    onCancel={() => setRenaming(false)}
                />
            ) : (
                <Select
                    className="chat-conversation-select"
                    size="small"
                    showSearch
                    optionFilterProp="title"
                    loading={loading && conversations.length === 0}
                    value={active?.id ?? null}
                    options={options}
                    onChange={onSelect}
                    placeholder={loading ? 'Loading…' : 'No conversations here.'}
                    notFoundContent="No conversations here."
                    classNames={{ popup: { root: 'chat-conversation-popup' } }}
                    aria-label="Conversation"
                />
            )}
            {runningElsewhere > 0 && (
                <Tooltip title={runningElsewhere === 1
                    ? 'One other conversation is running'
                    : `${runningElsewhere} other conversations are running`}>
                    <span className="chat-conversation-running-count">
                        <ChatConversationDot running />
                        {runningElsewhere}
                    </span>
                </Tooltip>
            )}
            {active && (
                <ChatConversationActions
                    conversation={active}
                    onStartRename={() => setRenaming(true)}
                    onTogglePin={() => onTogglePin(active.id)}
                    onArchive={() => onArchive(active.id)}
                    onDelete={() => onDelete(active.id)}
                />
            )}
        </div>
    );
};
