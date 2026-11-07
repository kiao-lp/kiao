
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import { useFileBrowsingPersistenceContext } from '@cms-core';
import { useChatSocketContext } from './ChatSocket-ctx';
import { useChatShow } from './ChatShow-ctx';
import { useChatConversations } from './useChatConversations';
import { useChatOptionLists } from './useChatOptionLists';
import { useChatAuth } from './useChatAuth';
import { useChatPreflight } from './useChatPreflight';

import {
    ChatConversationHead, ChatConversationList, ChatConversationRow,
} from './ChatConversationList';
import { ChatConversationPane, MAIN_PANE } from './ChatConversationPane';
import type { NewConversationSettings } from './ChatConversationPane';
import { ChatLoginPanel } from './ChatLoginPanel';
import { ChatProfileDialog } from './ChatProfileDialog';
import './ChatPrompt.css';

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const ChatPromptContent: React.FC = () => {
    const { currentPath } = useFileBrowsingPersistenceContext();
    const { socketState, onPromptDropped } = useChatSocketContext();

    const { conversations, activeId, setActiveId, loading: listLoading, create, show, fork, patch, remove } = useChatConversations();
    const { agents, loading: agentsLoading, optionsFor } = useChatOptionLists();
    const claudeEnabled = agents.some(entry => entry.value === 'claude');
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
    const mainSettingsRef = useRef<NewConversationSettings | null>(null);

    // A new conversation takes the folder the browser is in and the agent its starter names — the two things about it that can never be.
    const creating = useRef(false);
    const [profileStarter,setProfileStarter] = useState<string | null>(null);
    const newConversation = async (agent: string) => {
        if (optionsFor(agent).profiles) {setProfileStarter(agent);return;}
        if (creating.current) return;
        creating.current = true;
        const shown = mainSettingsRef.current;
        const settings = shown?.agent === agent ? shown : { agent };
        try {
            if (agent === 'codex' && !await canStart(agent)) return;
            await create({ folder: currentPath, ...settings });
            setTimeout(() => mainPromptRef.current?.focus(), 50);
        } catch (e) {
            report('Could not create a conversation')(e);
        } finally {
            creating.current = false;
        }
    };

    // Forking is asked of a message and branches *before* it: the copy holds everything above that prompt, and the prompt itself is.
    const forkConversation = (id: string, messageId: string, text: string) => {
        fork(id, messageId)
            .then(() => {
                setRestored({ paneKey: MAIN_PANE, text, attachments: [] });
                setTimeout(() => mainPromptRef.current?.focus(), 50);
            })
            .catch(report('Could not fork the conversation'));
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
        message.error('The agent service could not be reached; your message was not sent.');
    }), [onPromptDropped, pinnedIds, setActiveId]);

    const paneProps = {
        currentPath,
        agents,
        optionsFor,
        restoredPrompt: restored,
        canStart,
        onForkProfile: (id: string, profileId: string) => { void fork(id,undefined,undefined,profileId).catch(report('Could not change profile')); },
    };

    return (
        <div className="chat-prompt">
            {profileStarter && <ChatProfileDialog entry={optionsFor(profileStarter)} onCancel={() => setProfileStarter(null)} onCreate={async settings => {
                try {await create({folder:currentPath,...settings});setProfileStarter(null);} catch(cause) {report('Could not create a conversation')(cause);}
            }} />}

            {/* Server-side sign-in — renders only while the host's CLI is signed out ── */}
            {claudeEnabled && <ChatLoginPanel status={auth.status} onSignedIn={auth.refresh} />}

            {/* A bundle that cannot route this service's frames routes none of them, so say so where the user is looking rather than. */}
            {socketState === 'outdated' && (
                <div className="chat-socket-banner">
                    This Dashboard is older than the agent service. Reload the page to reconnect.
                </div>
            )}

            {/* A socket that dropped is retried, and a prompt sent meanwhile is held for the next one — but only for a few seconds. */}
            {socketState === 'closed' && socketWasLive && (
                <div className="chat-socket-banner chat-socket-banner--retrying">
                    Reconnecting to the agent service…
                </div>
            )}

            {/* No agent CLI on the machine at all — which is how a fresh kiao container now starts, neither CLI being baked into the. */}
            {!agentsLoading && agents.length === 0 && (
                <div className="chat-socket-banner">
                    No agent is enabled and available. Enable or install Claude Code, Codex, Muse or
                    OpenCode in the configuration panel, and this tab will offer it.
                </div>
            )}


            <ChatConversationHead folder={currentPath} agents={agents} onCreate={newConversation} />


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
                            onFork={forkConversation}
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
                        onCreate={create}
                        promptRef={mainPromptRef}
                        settingsRef={mainSettingsRef}
                        onFork={forkConversation}
                    />
                </div>
            </div>


        </div>
    );
};
