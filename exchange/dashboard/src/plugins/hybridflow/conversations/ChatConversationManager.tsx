import React, { useState } from 'react';
import { Alert, Button, Checkbox, Modal } from 'antd';
import type { HarnessConversation } from 'kiao-worker';
import { AsyncList, ConfirmationDialog } from '@kiao-dashboard-core';

interface ChatConversationManagerProps {
    open: boolean;
    conversations: HarnessConversation[];
    loading: boolean;
    listFailed: boolean;
    onRetry: () => void;
    onClose: () => void;
    onArchive: (id: string) => Promise<unknown>;
    onDelete: (id: string) => Promise<void>;
}

const actions = {
    archive: {
        label: 'Archive',
        past: 'archived',
        description: 'Archived conversations leave the switcher and remain available in this list.',
    },
    delete: {
        label: 'Delete',
        past: 'deleted',
        description: 'This also permanently deletes the conversation history.',
    },
};

type Action = keyof typeof actions;
type Batch = { action: Action; ids: string[] };
type Outcome = { type: 'success' | 'error'; title: string };

const conversationCount = (count: number) => `${count} ${count === 1 ? 'conversation' : 'conversations'}`;
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const ChatConversationManager: React.FC<ChatConversationManagerProps> = ({
    open, conversations, loading, listFailed, onRetry, onClose, onArchive, onDelete,
}) => {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
    const [batch, setBatch] = useState<Batch | null>(null);
    const [outcome, setOutcome] = useState<Outcome | null>(null);

    const selected = conversations.filter(conversation => selectedIds.has(conversation.id));
    const archivable = selected.filter(conversation => !conversation.archived);
    const confirmation = batch && actions[batch.action];
    const unavailable = loading || listFailed || !!batch;

    const toggle = (id: string, checked: boolean) => {
        setSelectedIds(previous => {
            const next = new Set(previous);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
        });
    };

    const confirm = (action: Action, targets: HarnessConversation[]) => {
        setOutcome(null);
        setBatch({ action, ids: targets.map(target => target.id) });
    };

    const apply = async () => {
        if (!batch) return;
        const change = batch.action === 'archive' ? onArchive : onDelete;
        const failed = new Set<string>();
        for (const id of batch.ids) {
            try {
                await change(id);
            } catch {
                failed.add(id);
            }
        }
        const completed = batch.ids.length - failed.size;
        const past = actions[batch.action].past;
        const title = [
            completed > 0 && `${conversationCount(completed)} ${past}.`,
            failed.size > 0 && `${conversationCount(failed.size)} could not be ${past}.`,
        ].filter(Boolean).join(' ');
        setSelectedIds(failed);
        setOutcome({ type: failed.size ? 'error' : 'success', title });
        setBatch(null);
    };

    return (
        <Modal
            open={open}
            centered
            title="Manage conversations"
            destroyOnHidden
            maskClosable={false}
            keyboard={!batch}
            closable={!batch}
            onCancel={onClose}
            afterClose={() => {
                setSelectedIds(new Set());
                setOutcome(null);
            }}
            classNames={{
                container: 'chat-conversation-manager-container',
                body: 'chat-conversation-manager-body',
            }}
            footer={<>
                <Button disabled={unavailable || archivable.length === 0}
                    onClick={() => confirm('archive', archivable)}>Archive</Button>
                <Button danger disabled={unavailable || selected.length === 0}
                    onClick={() => confirm('delete', selected)}>Delete</Button>
            </>}
        >
            <AsyncList loading={loading} loadingLabel="Loading conversations"
                error={listFailed && 'The conversations could not be loaded.'} onRetry={onRetry}
                empty={!conversations.length && 'No conversations.'}>
                <ul className="chat-conversation-manager-list" aria-label="All conversations" tabIndex={0}>
                    {open && conversations.map(conversation => {
                        const updated = Date.parse(conversation.updatedAt);
                        return (
                            <li key={conversation.id}>
                                <Checkbox
                                    className="chat-conversation-manager-option"
                                    checked={selectedIds.has(conversation.id)}
                                    disabled={!!batch}
                                    onChange={event => toggle(conversation.id, event.target.checked)}
                                >
                                    {conversation.title}
                                    <span className="chat-conversation-manager-detail">
                                        {conversation.folder || 'DCMS root'}
                                        {Number.isFinite(updated) && <> · <time dateTime={conversation.updatedAt}>{dateTime.format(updated)}</time></>}
                                        {conversation.archived && ' · Archived'}
                                    </span>
                                </Checkbox>
                            </li>
                        );
                    })}
                </ul>
            </AsyncList>
            {outcome && <Alert type={outcome.type} title={outcome.title} showIcon />}
            <ConfirmationDialog
                open={!!batch}
                title={confirmation ? `${confirmation.label} ${conversationCount(batch.ids.length)}?` : ''}
                description={confirmation?.description}
                confirmText={confirmation?.label}
                danger={batch?.action === 'delete'}
                onCancel={() => setBatch(null)}
                onConfirm={apply}
            />
        </Modal>
    );
};
