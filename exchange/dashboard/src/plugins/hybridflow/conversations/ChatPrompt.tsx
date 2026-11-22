
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { HarnessConversation, HarnessPermissionMode } from 'kiao-worker';
import { useFileBrowsingPersistenceContext } from '@kiao-dashboard-core';
import { useChatSocketContext } from './ChatSocket-ctx';
import { useChatShow } from './ChatShow-ctx';
import { useChatConversations } from './useChatConversations';
import { useHarnessOptions } from '../useHarnessOptions';
import { useChatAuth } from './useChatAuth';
import { useChatPreflight } from './useChatPreflight';

import {
    ChatConversationList, ChatConversationRow,
} from './ChatConversationList';
import { ChatConversationPane, MAIN_PANE } from './ChatConversationPane';
import { ChatAgentDialog } from './ChatAgentDialog';
import { ChatLoginPanel } from './ChatLoginPanel';
import './ChatPrompt.css';

type AgentRequest =
    | { kind: 'create'; folder: string; afterCreate?: (conversation: HarnessConversation) => void }
    | { kind: 'fork'; source: HarnessConversation; messageId?: string; text?: string };

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const ChatPromptContent: React.FC = () => {
    const { currentPath } = useFileBrowsingPersistenceContext();
    const { socketState, onPromptDropped } = useChatSocketContext();

    const { conversations, activeId, setActiveId, loading: listLoading, create, show, fork, patch, remove } = useChatConversations();
    const { harnesses, loading: harnessesLoading, optionsFor } = useHarnessOptions();
    const claudeEnabled = harnesses.some(entry => entry.value === 'claude');
    const auth = useChatAuth(claudeEnabled);
    const canStart = useChatPreflight();

    const pinned = useMemo(
        () => conversations
            .filter(entry => entry.pinned)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
        [conversations],
    );
    const unpinned = useMemo(() => conversations.filter(entry => !entry.pinned), [conversations]);
    const pinnedIds = useMemo(() => new Set(pinned.map(entry => entry.id)), [pinned]);

    // keep this one current in every tab, while the transcript is only re-read at a turn boundary.
    const activeConversation = useMemo(
        () => conversations.find(entry => entry.id === activeId) ?? null,
        [conversations, activeId],
    );

    // mounted only when the toolbar is switched to this tab, which is what playing does.
    const { toShow, shown } = useChatShow();
    useEffect(() => {
        if (!toShow) return;
        show(toShow);
        shown();
    }, [toShow, show, shown]);

    // A pinned conversation has a column of its own, so the main column must not be showing it too.
    useEffect(() => {
        if (activeId && pinnedIds.has(activeId)) setActiveId(null);
    }, [activeId, pinnedIds, setActiveId]);

    // page that has only just mounted has not lost a service it never reached.
    const [socketWasLive, setSocketWasLive] = useState(false);
    useEffect(() => {
        if (socketState !== 'closed') setSocketWasLive(true);
    }, [socketState]);

    const report = (what: string) => (e: unknown) => { message.error(`${what}: ${errorText(e)}`); };

    const mainPromptRef = useRef<HTMLTextAreaElement>(null);
    const [agentRequest, setAgentRequest] = useState<AgentRequest | null>(null);
    const requestAgent = (afterCreate?: (conversation: HarnessConversation) => void) => {
        setAgentRequest({ kind: 'create', folder: currentPath, afterCreate });
    };
    const forkConversation = (source: HarnessConversation, messageId?: string, text?: string) => {
        setAgentRequest({ kind: 'fork', source, messageId, text });
    };

    const togglePin = (id: string, pinnedNow: boolean) => {
        patch(id, { pinned: !pinnedNow })
            .then(() => { if (pinnedNow) setActiveId(id); })
            .catch(report(pinnedNow ? 'Could not unpin the conversation' : 'Could not pin the conversation'));
    };

    const [restored, setRestored] = useState<{ paneKey: string; text: string; attachments: string[] } | null>(null);
    useEffect(() => onPromptDropped((conversationId, text, attachments) => {
        const pinnedHere = pinnedIds.has(conversationId);
        setRestored({ paneKey: pinnedHere ? conversationId : MAIN_PANE, text, attachments });
        if (!pinnedHere) setActiveId(conversationId);
        message.error('The harness service could not be reached; your message was not sent.');
    }), [onPromptDropped, pinnedIds, setActiveId]);

    const paneProps = {
        currentPath,
        harnesses,
        optionsFor,
        restoredPrompt: restored,
        canStart,
        onFork: forkConversation,
    };

    return (
        <div className="chat-prompt">
            {agentRequest && (
                <ChatAgentDialog
                    title={agentRequest.kind === 'create' ? 'New conversation' : 'Fork with an agent'}
                    confirmLabel={agentRequest.kind === 'fork' ? 'Fork conversation' : undefined}
                    initial={agentRequest.kind === 'fork' ? {
                        agent: agentRequest.source.agentVersion?.agentId,
                        harness: agentRequest.source.harness,
                        profileId: agentRequest.source.profileId,
                        model: agentRequest.source.model,
                    } : undefined}
                    allowDraft={agentRequest.kind === 'create'}
                    harnesses={harnesses}
                    harnessesLoading={harnessesLoading}
                    onCancel={() => setAgentRequest(null)}
                    onConfirm={async ({ agent, harness, profileId, model }, useDraft) => {
                        if (agentRequest.kind === 'create') {
                            if (!await canStart(harness)) {
                                setAgentRequest(null);
                                return;
                            }
                            const own = optionsFor(harness);
                            const permissionMode = own.permissionModes.find(mode => mode.value === 'manual')
                                ?? own.permissionModes[0];
                            const created = await create({
                                folder: agentRequest.folder,
                                agentId: agent,
                                harness, profileId, model,
                                useDraft: useDraft || undefined,
                                permissionMode: permissionMode?.value as HarnessPermissionMode | undefined,
                            });
                            agentRequest.afterCreate?.(created);
                        } else {
                            await fork(agentRequest.source.id, { agentId: agent, harness, profileId, model, fromMessageId: agentRequest.messageId });
                            if (agentRequest.text !== undefined) {
                                setRestored({ paneKey: MAIN_PANE, text: agentRequest.text, attachments: [] });
                            }
                        }
                        setAgentRequest(null);
                        setTimeout(() => mainPromptRef.current?.focus(), 50);
                    }}
                />
            )}

            {/* Server-side sign-in — renders only while the host's CLI is signed out ── */}
            {claudeEnabled && <ChatLoginPanel status={auth.status} onSignedIn={auth.refresh} />}

            {/* A bundle that cannot route this service's frames routes none of them, so say so where the user is looking rather than. */}
            {socketState === 'outdated' && (
                <div className="chat-socket-banner">
                    This Dashboard is older than the harness service. Reload the page to reconnect.
                </div>
            )}

            {/* A socket that dropped is retried, and a prompt sent meanwhile is held for the next one — but only for a few seconds. */}
            {socketState === 'closed' && socketWasLive && (
                <div className="chat-socket-banner chat-socket-banner--retrying">
                    Reconnecting to the harness service…
                </div>
            )}

            {/* No harness CLI on the machine at all — which is how a fresh kiao container now starts, neither CLI being baked into the. */}
            {!harnessesLoading && harnesses.length === 0 && (
                <div className="chat-socket-banner">
                    No harness is enabled and available. Enable or install Claude Code, Codex, Muse or
                    Pi in the configuration panel, and this tab will offer it.
                </div>
            )}


            <div className="chat-conversation-head">
                <span className="chat-conversation-head-label">Conversations</span>
                <Button
                    size="small"
                    type="text"
                    icon={<PlusOutlined />}
                    aria-label="New conversation"
                    onClick={() => requestAgent()}
                />
            </div>


            <div className="chat-columns">
                {pinned.map(conversation => (
                    <div className="chat-column chat-column--pinned" key={conversation.id}>

                        <ChatConversationRow
                            conversation={conversation}
                            active={false}
                            header
                            onSelect={() => { /* already shown, in this very column */ }}
                            onRename={title => { patch(conversation.id, { title }).catch(report('Could not rename the conversation')); }}
                            onTogglePin={() => togglePin(conversation.id, true)}
                            onArchive={() => { patch(conversation.id, { archived: true }).catch(report('Could not archive the conversation')); }}
                            onDelete={() => { remove(conversation.id).catch(report('Could not delete the conversation')); }}
                        />
                        <ChatConversationPane
                            {...paneProps}
                            paneKey={conversation.id}
                            conversationId={conversation.id}
                            conversation={conversation}
                        />
                    </div>
                ))}

                <div className="chat-column chat-column--main">
                    <ChatConversationList
                        conversations={unpinned}
                        activeId={activeId}
                        loading={listLoading}
                        onSelect={setActiveId}
                        onRename={(id, title) => { patch(id, { title }).catch(report('Could not rename the conversation')); }}
                        onTogglePin={id => togglePin(id, false)}
                        onArchive={id => { patch(id, { archived: true }).catch(report('Could not archive the conversation')); }}
                        onDelete={id => { remove(id).catch(report('Could not delete the conversation')); }}
                    />

                    <ChatConversationPane
                        {...paneProps}
                        paneKey={MAIN_PANE}
                        conversationId={activeId}
                        conversation={activeConversation}
                        onRequestAgent={requestAgent}
                        promptRef={mainPromptRef}
                    />
                </div>
            </div>


        </div>
    );
};
