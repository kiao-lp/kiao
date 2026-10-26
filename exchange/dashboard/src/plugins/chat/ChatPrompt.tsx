// ── The Conversations panel ────────────────────────────────────────────────────
//
// The switcher and the chats it switches between. A chat is `ChatConversationPane`; this file is
// what holds several of them at once.
//
// **Pinning is what makes it several.** An unpinned conversation is a row in the list, and the one
// selected shows its chat below — the panel as it has always been. Pinning takes a conversation out
// of that list and gives it a column of its own, to the left of it, so two or three chats can be
// watched and answered side by side instead of switched between. Nothing else about the
// conversation changes: `pinned` is a display choice the service stores, so the arrangement is the
// same in the next tab and on the next machine.
//
// Everything that is one per panel is read here and handed down — the socket, the registry, the
// option lists — so N columns are still one of each.

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
    const claudeEnabled = !agentsLoading && agents.some(entry => entry.value === 'claude');
    const auth = useChatAuth(claudeEnabled);
    const canStart = useChatPreflight();

    // Oldest first, and by creation rather than by the registry's own most-recently-updated order:
    // a column is a place on the screen, and one that swapped with its neighbour every time a turn
    // finished would be a place nobody could learn. Creation order never changes, so a column moves
    // only when something is pinned or unpinned. The id carries the creation millisecond, which is
    // what breaks a tie between two made in the same one.
    const pinned = useMemo(
        () => conversations
            .filter(entry => entry.pinned)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
        [conversations],
    );
    const unpinned = useMemo(() => conversations.filter(entry => !entry.pinned), [conversations]);
    const pinnedIds = useMemo(() => new Set(pinned.map(entry => entry.id)), [pinned]);

    // The registry's copy of the selected conversation rather than the transcript's: registry frames
    // keep this one current in every tab, while the transcript is only re-read at a turn boundary.
    const activeConversation = useMemo(
        () => conversations.find(entry => entry.id === activeId) ?? null,
        [conversations, activeId],
    );

    // A conversation somebody else made — a flow node played from the board — is shown here as if
    // it had come from the `+` above. It is held until this runs, so it survives the panel being
    // mounted only when the toolbar is switched to this tab, which is what playing does.
    const { toShow, shown } = useChatShow();
    useEffect(() => {
        if (!toShow) return;
        show(toShow);
        shown();
    }, [toShow, show, shown]);

    // A pinned conversation has a column of its own, so the main column must not be showing it too.
    // An effect rather than part of the click, because the pin may have been made in another tab.
    useEffect(() => {
        if (activeId && pinnedIds.has(activeId)) setActiveId(null);
    }, [activeId, pinnedIds, setActiveId]);

    // `closed` is also the transport's state before anything has asked it to open a socket, and a
    // page that has only just mounted has not lost a service it never reached. The banner waits for
    // a first attempt, so it means what it says.
    const [socketWasLive, setSocketWasLive] = useState(false);
    useEffect(() => {
        if (socketState !== 'closed') setSocketWasLive(true);
    }, [socketState]);

    // The switcher's actions are single clicks with no other feedback, so a request that failed is
    // said out loud rather than left in the console looking like nothing happened.
    const report = (what: string) => (e: unknown) => { message.error(`${what}: ${errorText(e)}`); };

    // The main column's box and the settings its toolbar is showing. `+ New conversation` sits above
    // every column, so it reads both from here: a conversation made from it starts on the settings
    // the user is looking at, and the caret lands in the box they will type into.
    const mainPromptRef = useRef<HTMLTextAreaElement>(null);
    const mainSettingsRef = useRef<NewConversationSettings | null>(null);

    // A new conversation takes the folder the browser is in and the agent its starter names — the
    // two things about it that can never be changed afterwards, one being the CLI's working
    // directory and the other the engine whose session it will hold.
    //
    // The box's settings go with it only when the starter is the box's own agent. A model, an effort
    // and a permission mode are the vocabulary of the engine they were picked for — `opus` is a
    // Claude model and no model at all on Codex, and a mode the other engine does not publish is a
    // `400` — so a starter for another agent creates on that agent's own defaults instead.
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

    // Forking is asked of a message and branches *before* it: the copy holds everything above that
    // prompt, and the prompt itself is handed back to the box, because asking it again — differently
    // — is the only reason to branch there. That hand-back is the same path a prompt the transport
    // dropped takes, for the same reason: it is text the user is owed a chance to send.
    //
    // Forking switches to the copy, which the hook does. Pinned or not, the fork itself is unpinned
    // and therefore lands in the main column — so a fork of a pinned chat opens beside it rather than
    // over it, which is what makes the two comparable. The text therefore goes to the main box, and
    // never to the column the fork was asked from.
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
            // Unpinning puts the conversation back in the list, and the user is plainly still
            // reading it — so it lands in the main column rather than nowhere.
            .then(() => { if (pinnedNow) setActiveId(id); })
            .catch(report(pinnedNow ? 'Could not unpin the conversation' : 'Could not pin the conversation'));
    };

    // Text a box is owed: a prompt the transport gave up on, or the prompt a fork was asked at, which
    // the copy is there to have asked again. It is addressed back to a *column* rather than to a
    // conversation: a pinned chat has a box of its own, and everything else was typed in the main
    // one — which is then switched to the conversation the text was meant for, so it is given back
    // where it can be sent again.
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

            {/* ── Server-side sign-in — renders only while the host's CLI is signed out ── */}
            {claudeEnabled && <ChatLoginPanel status={auth.status} onSignedIn={auth.refresh} />}

            {/* A bundle that cannot route this service's frames routes none of them, so say so where
                the user is looking rather than leave a panel that silently never updates. */}
            {socketState === 'outdated' && (
                <div className="chat-socket-banner">
                    This Dashboard is older than the agent service. Reload the page to reconnect.
                </div>
            )}

            {/* A socket that dropped is retried, and a prompt sent meanwhile is held for the next
                one — but only for a few seconds. Saying nothing is what makes a message sent into a
                dropped socket look like one that was sent and ignored. */}
            {socketState === 'closed' && socketWasLive && (
                <div className="chat-socket-banner chat-socket-banner--retrying">
                    Reconnecting to the agent service…
                </div>
            )}

            {/* No agent CLI on the machine at all — which is how a fresh kiao container now
                starts, neither CLI being baked into the image any more. Said here, once, because
                every other surface would report it as a turn that failed: the prompt box works, the
                socket is up, and the first message would come back "this service does not offer the
                agent claude" with nothing to suggest where to go. */}
            {!agentsLoading && agents.length === 0 && (
                <div className="chat-socket-banner">
                    No agent is enabled and available. Enable or install Claude Code, Codex, Muse or
                    OpenCode in the configuration panel, and this tab will offer it.
                </div>
            )}

            {/* ── The switcher's title bar, above every column: one starter per agent offered ── */}
            <ChatConversationHead folder={currentPath} agents={agents} onCreate={newConversation} />

            {/* ── One column per pinned conversation, then the list and whatever it has selected ── */}
            <div className="chat-columns">
                {pinned.map(conversation => (
                    <div className="chat-column chat-column--pinned" key={conversation.id}>
                        {/* The column's own title bar: the same row the list shows, so unpinning,
                            renaming, archiving and deleting are where they always were. Clicking it
                            selects nothing — the chat it names is already right underneath. */}
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
                    {/* Not keyed on the conversation: the draft in its box is the user's and survives
                        switching, the way one box for every conversation always has. */}
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

            {/* The quota is *not* here but in the Usage tab beside this one: one section per
                agent, each with its own refresh. Two engines are two accounts, and a column is
                where neither answer would be the whole of it. */}
        </div>
    );
};
