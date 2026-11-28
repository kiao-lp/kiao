// the registry's, kept fresh by the `conversation` frames every open socket receives — and the only That map is why an option can.

import React, { useState } from 'react';
import { Select } from 'antd';
import { CommitInput, IconButton, Tooltip } from '@kiao-dashboard-core';
import {
    EditOutlined, PushpinFilled, PushpinOutlined, SettingOutlined,
} from '@ant-design/icons';
import type { HarnessConversation } from 'kiao-worker';
import { useChatSocketContext } from './ChatSocket-ctx';
import type { ConversationRuntime } from './chatConversationReducer';

/** How a folder reads in a sentence. */
const folderLabel = (folder: string): string => folder || 'the DCMS root';

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

const ChatConversationActions: React.FC<{
    conversation: HarnessConversation | null;
    onStartRename: () => void;
    onTogglePin: () => void;
    onManage: () => void;
}> = ({ conversation, onStartRename, onTogglePin, onManage }) => (
    // The actions never select the conversation they sit beside.
    <span className="chat-conversation-actions" onClick={e => e.stopPropagation()}>
        {conversation && <>
            <IconButton label="Rename" icon={<EditOutlined />} onClick={onStartRename} />
            <IconButton
                label={conversation.pinned ? 'Unpin' : 'Pin'}
                tooltip={conversation.pinned
                    ? 'Unpin — put it back in the list'
                    : 'Pin — give it a column of its own, beside the list'}
                icon={conversation.pinned ? <PushpinFilled /> : <PushpinOutlined />}
                aria-pressed={conversation.pinned}
                onClick={onTogglePin}
            />
        </>}
        <IconButton
            label="Manage conversations"
            tooltip
            icon={<SettingOutlined />}
            aria-haspopup="dialog"
            onClick={onManage}
        />
    </span>
);

/** The box a title is retyped in, in place of whatever was showing it. */
const HarnessConversationRename: React.FC<{
    title: string;
    onRename: (title: string) => void;
    onClose: () => void;
}> = ({ title, onRename, onClose }) => (
    <CommitInput
        className="chat-conversation-rename"
        aria-label="Conversation name"
        value={title}
        autoFocus
        preserveDraft
        onClick={event => event.stopPropagation()}
        onCommit={value => {
            onClose();
            const next = value.trim();
            if (next !== title) onRename(next);
        }}
        onCancel={onClose}
    />
);

export const ChatConversationRow: React.FC<{
    conversation: HarnessConversation;
    active: boolean;

    header?: boolean;
    onSelect: () => void;
    onRename: (title: string) => void;
    onTogglePin: () => void;
    onManage: () => void;
}> = ({ conversation, active, header, onSelect, onRename, onTogglePin, onManage }) => {
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
                    onRename={onRename}
                    onClose={() => setRenaming(false)}
                />
            ) : (
                <span className="chat-conversation-title">{conversation.title}</span>
            )}
            <ChatConversationActions
                conversation={conversation}
                onStartRename={() => setRenaming(true)}
                onTogglePin={onTogglePin}
                onManage={onManage}
            />
        </div>
    );
};

/** The conversations that share a column: the unpinned ones, picked from a select, with the chosen one. */
export const ChatConversationList: React.FC<{
    conversations: HarnessConversation[];
    activeId: string | null;
    loading: boolean;
    onSelect: (id: string) => void;
    onRename: (id: string, title: string) => void;
    onTogglePin: (id: string) => void;
    onManage: () => void;
}> = ({ conversations, activeId, loading, onSelect, onRename, onTogglePin, onManage }) => {
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
                    key={active.id}
                    title={active.title}
                    onRename={title => onRename(active.id, title)}
                    onClose={() => setRenaming(false)}
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
            <ChatConversationActions
                conversation={active}
                onStartRename={() => setRenaming(true)}
                onTogglePin={() => active && onTogglePin(active.id)}
                onManage={onManage}
            />
        </div>
    );
};
