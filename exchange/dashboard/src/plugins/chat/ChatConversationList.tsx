// the registry's, kept fresh by the `conversation` frames every open socket receives — and the only That map is why an option can.

import React, { useState } from 'react';
import { Button, Input, Popconfirm, Select } from 'antd';
import { Tooltip } from '@kiao-dashboard-core';
import {
    DeleteOutlined, EditOutlined, InboxOutlined, PlusCircleOutlined, PlusOutlined,
    PlusSquareOutlined, PushpinFilled, PushpinOutlined,
} from '@ant-design/icons';
import type { HarnessConversation, HarnessOptionsEntry } from 'kiao-worker';
import { useChatSocketContext } from './ChatSocket-ctx';
import type { ConversationRuntime } from './chatConversationReducer';

/** How a folder reads in a sentence. */
const folderLabel = (folder: string): string => folder || 'the store root';

/** How a conversation reads on hover: what it is called, where it runs, how long it has been going. */
const conversationTitle = (conversation: HarnessConversation): string =>
    `${conversation.title}\n${folderLabel(conversation.folder)} · ${conversation.messageCount} messages`;

/** The runtime knows first for a conversation this tab watches; the record answers for the rest,. */
const isRunning = (
    conversation: HarnessConversation,
    runtimes: Record<string, ConversationRuntime>,
): boolean => runtimes[conversation.id]?.running || conversation.running;

/** Only the lit dot carries a label: an idle conversation is the normal state, and a reader gains. */
const ChatConversationDot: React.FC<{ running: boolean }> = ({ running }) => (
    <span
        className={`chat-conversation-dot${running ? ' chat-conversation-dot--running' : ''}`}
        role={running ? 'img' : undefined}
        aria-label={running ? 'A turn is running' : undefined}
    />
);

/** What can be done to one conversation. */
const ChatConversationActions: React.FC<{
    conversation: HarnessConversation;
    onStartRename: () => void;
    onTogglePin: () => void;
    onArchive: () => void;
    onDelete: () => void;
}> = ({ conversation, onStartRename, onTogglePin, onArchive, onDelete }) => (
    // The actions never select the conversation they sit beside.
    <span className="chat-conversation-actions" onClick={e => e.stopPropagation()}>
        <Button size="small" type="text" icon={<EditOutlined />} aria-label="Rename" onClick={onStartRename} />

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

        <Popconfirm
            title="Delete this conversation?"
            description="Its transcript goes with it."
            okText="Delete"
            okButtonProps={{ danger: true }}
            placement="topRight"
            onConfirm={onDelete}
        >
            <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="Delete" />
        </Popconfirm>
    </span>
);

/** The box a title is retyped in, in place of whatever was showing it. */
const HarnessConversationRename: React.FC<{
    title: string;
    onDone: (title: string) => void;
    onCancel: () => void;
}> = ({ title, onDone, onCancel }) => {
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
            onPressEnter={finish}
            onBlur={finish}
            onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
        />
    );
};

export const ChatConversationRow: React.FC<{
    conversation: HarnessConversation;
    active: boolean;

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
                <HarnessConversationRename
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
 * The marks the starters are told apart by.
 * All plainly a `+`, because what every one of them does is the same thing — a conversation in.
 */
const STARTER_MARKS = [<PlusOutlined />, <PlusSquareOutlined />, <PlusCircleOutlined />];

const starterMark = (index: number): React.ReactNode =>
    STARTER_MARKS[Math.min(index, STARTER_MARKS.length - 1)];

/** The switcher's title bar. */
export const ChatConversationHead: React.FC<{
    folder: string;

    harnesses: HarnessOptionsEntry[];
    onCreate: (harness: string) => void;
}> = ({ folder, harnesses, onCreate }) => (
    <div className="chat-conversation-head">
        <span className="chat-conversation-head-label">Conversations</span>
        <span className="chat-conversation-head-starters">
            {harnesses.map((harness, index) => (
                <Tooltip
                    key={harness.value}
                    title="Starts a conversation with this harness; its harness stays fixed."
                >
                    <Button
                        size="small"
                        type="text"
                        icon={starterMark(index)}
                        aria-label={`New ${harness.label} conversation`}
                        onClick={() => onCreate(harness.value)}
                    />
                </Tooltip>
            ))}
        </span>
    </div>
);

/** The conversations that share a column: the unpinned ones, picked from a select, with the chosen one. */
export const ChatConversationList: React.FC<{
    conversations: HarnessConversation[];
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
        title: conversationTitle(conversation),
        label: (
            <span className="chat-conversation-option">
                <ChatConversationDot running={isRunning(conversation, runtimes)} />
                <span className="chat-conversation-title">{conversation.title}</span>
            </span>
        ),
    }));

    const runningElsewhere = conversations
        .filter(conversation => conversation.id !== activeId && isRunning(conversation, runtimes))
        .length;

    return (
        <div className="chat-conversation-list">
            {renaming && active ? (
                <HarnessConversationRename
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
