
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { HarnessConversation } from 'kiao-worker';
import { IconButton, useFileBrowsingPersistenceContext } from '@kiao-dashboard-core';
import { useChatSocketContext } from './ChatSocket-ctx';
import { useChatShow } from './ChatShow-ctx';
import { useChatConversations } from './useChatConversations';
import { useHarnessOptions } from '../useHarnessOptions';
import { useChatAuth } from './useChatAuth';
import { useChatPreflight } from './useChatPreflight';

import {
    ChatConversationList, ChatConversationRow,
} from './ChatConversationList';
import { ChatConversationManager } from './ChatConversationManager';
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

    const {
        conversations, allConversations, activeId, setActiveId, loading: listLoading, listFailed,
        create, show, fork, patch, remove, refresh,
    } = useChatConversations();
    const [managing, setManaging] = useState(false);
    const [responseTokenLimits, setResponseTokenLimits] = useState(() => new Map<string | null, string>());
    const changeResponseTokenLimit = (id: string | null, limit: string | undefined) => {
        setResponseTokenLimits(previous => {
            const next = new Map(previous);
            if (limit) next.set(id, limit);
            else next.delete(id);
            return next;
        });
    };
    const openManager = () => setManaging(true);
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
        changeResponseTokenLimit,
    };

    return (
        <div className="chat-prompt">
            <ChatConversationManager
                open={managing}
                conversations={allConversations}
                loading={listLoading}
                listFailed={listFailed}
                onRetry={refresh}
                onClose={() => setManaging(false)}
                onArchive={id => patch(id, { archived: true })}
                onDelete={remove}
            />
            {agentRequest && (
                <ChatAgentDialog
                    title={agentRequest.kind === 'create' ? 'New conversation' : 'Fork with an agent'}
                    confirmLabel={agentRequest.kind === 'fork' ? 'Fork conversation' : undefined}
                    pendingLabel={agentRequest.kind === 'fork' ? 'Forking conversation…' : 'Starting conversation…'}
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
                            const created = await create({
                                folder: agentRequest.folder,
                                agentId: agent,
                                harness, profileId, model,
                                useDraft: useDraft || undefined,
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
                <IconButton label="New conversation" icon={<PlusOutlined />} onClick={() => requestAgent()} />
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
                            onManage={openManager}
                        />
                        <ChatConversationPane
                            {...paneProps}
                            paneKey={conversation.id}
                            conversationId={conversation.id}
                            conversation={conversation}
                            responseTokenLimit={responseTokenLimits.get(conversation.id)}
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
                        onManage={openManager}
                    />

                    <ChatConversationPane
                        {...paneProps}
                        paneKey={MAIN_PANE}
                        conversationId={activeId}
                        conversation={activeConversation}
                        responseTokenLimit={responseTokenLimits.get(activeId)}
                        onRequestAgent={requestAgent}
                        promptRef={mainPromptRef}
                    />
                </div>
            </div>


        </div>
    );
};
