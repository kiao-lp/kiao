// ── The boards being played ───────────────────────────────────────────────────
//
// A board's run belongs to **worker**, not to this page: it plays a flow node, files what
// the agent said under it, marks it and follows the chain, whether or not a browser is connected. This
// provider is the page's view of those runs — what each is doing, and what can be asked of one.
//
// **It lives in the chat plugin rather than in the board's**, because the runs arrive on the chat
// socket and because the chat panel needs them too: stopping a turn stops the run it belonged to, and
// the next message typed into that chat is where the user is asked whether to pick it back up. The
// board and the chain-run panel read them from here, as they already read the runner and the
// option
// lists.
//
// **There are several, and the service owns the list**, so this is one piece of state for the whole
// page: two tabs say the same thing about it, and every frame carries the whole list rather than the
// run that moved — a client merging deltas would be a second place the truth lived.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { message } from 'antd';
import type { AgentChainRunNotice, AgentChainRun } from 'kiao-worker';
import { useWorkerClient, useDashboardConfig } from '@cms-core';
import { localizeNoticeDateTimes } from '@cms-kit/date-time';
import { useChatSocketContext } from './ChatSocket-ctx';

export interface ChatChainRunsValue {
    /** Every run the service knows, live and lately ended, oldest first. */
    runs: AgentChainRun[];
    /**
     * Plays a flow node of a board and the chain it starts, under the name the user gave this run. Other
     * runs are left alone; a card another run is already playing is refused.
     */
    play: (path: string, flowNodeId: string, name: string) => void;
    /**
     * Ends one run. The turn under way finishes and is filed like any other; nothing after it starts.
     * The run stays in the list saying it is over, which is what a restart is offered on.
     */
    stop: (runId: string) => void;
    /** Picks a suspended run back up, with the message about to be sent as its flow node's turn. */
    resume: (runId: string) => Promise<void>;
    /** Plays an ended run again from the card it was started on, under the name it already has. */
    restart: (runId: string) => void;
    /** Takes an ended run out of the list. */
    forget: (runId: string) => void;
}

const ChatChainRunsContext = createContext<ChatChainRunsValue | null>(null);

export const useChatChainRuns = (): ChatChainRunsValue => {
    const ctx = useContext(ChatChainRunsContext);
    if (!ctx) throw new Error('useChatChainRuns must be used within a ChatChainRunsProvider');
    return ctx;
};

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * What a notice is said as. The run decides both the words and how loudly they are said, and it says
 * which chain run decided it — several speak at once, and an unattributed line about a flow node being
 * tried again at twenty past is a line nobody can act on.
 */
const say = (notice: AgentChainRunNotice) => {
    const words = localizeNoticeDateTimes(notice.text);
    const text = notice.chainRun ? `${notice.chainRun} — ${words}` : words;
    if (notice.level === 'error') message.error(text);
    else if (notice.level === 'warning') message.warning(text);
    else message.info(text);
};

export const ChatChainRunsProvider: React.FC<{ children?: ReactNode }> = ({ children }) => {
    const client = useWorkerClient();
    const { chatEnabled } = useDashboardConfig();
    const { onChainRun, onHello } = useChatSocketContext();
    const [runs, setRuns] = useState<AgentChainRun[]>([]);

    // Nothing is asked of the service on a deployment with no Conversations panel. This provider is mounted
    // whatever the configuration says — plugin providers are — and both a subscription and the read
    // below would open a socket to a feature that is switched off.
    const watching = chatEnabled;

    // Every change to the runs, and the line one of them wants said about it. Both are shown as they
    // arrive rather than compared against the last state: the service sends the frame once, to every
    // socket, at the moment it decided whatever it decided.
    useEffect(() => {
        if (!watching) return;
        return onChainRun(frame => {
            setRuns(frame.runs ?? []);
            if (frame.notice) say(frame.notice);
        });
    }, [watching, onChainRun]);

    // `hello` is what repairs a tab that connected late or reconnected: it carries the runs the way it
    // carries the turns that are running, so nothing has to be polled.
    useEffect(() => {
        if (!watching) return;
        return onHello(hello => setRuns(hello.chainRuns ?? []));
    }, [watching, onHello]);

    // The one read. It covers the moment before the socket is open — a board drawn on the first paint
    // has to know whether it is playing — and nothing after it, which is the socket's business.
    useEffect(() => {
        if (!watching) return;
        let dropped = false;
        client.getChainRuns()
            .then(current => { if (!dropped) setRuns(current); })
            .catch(error => console.error('Failed to read the chain runs', error));
        return () => { dropped = true; };
    }, [watching, client]);

    const play = useCallback((path: string, flowNodeId: string, name: string) => {
        // The answer is not applied here: the runs travel back as a `chainRun` frame to every
        // tab,
        // including this one, and taking the reply as well would be two sources for one state.
        client.playChainRun(path, flowNodeId, name)
            .catch(error => message.error(`The flow node could not be played: ${errorText(error)}`));
    }, [client]);

    const stop = useCallback((runId: string) => {
        client.stopChainRun(runId)
            .catch(error => message.error(`The play could not be stopped: ${errorText(error)}`));
    }, [client]);

    const resume = useCallback(async (runId: string) => {
        try {
            await client.resumeChainRun(runId);
        } catch (error) {
            message.error(`The play could not be resumed: ${errorText(error)}`);
        }
    }, [client]);

    const restart = useCallback((runId: string) => {
        client.restartChainRun(runId)
            .catch(error => message.error(`The chain run could not be restarted: ${errorText(error)}`));
    }, [client]);

    const forget = useCallback((runId: string) => {
        client.forgetChainRun(runId)
            .catch(error => message.error(`The chain run could not be dropped: ${errorText(error)}`));
    }, [client]);

    const value = useMemo<ChatChainRunsValue>(
        () => ({ runs, play, stop, resume, restart, forget }),
        [runs, play, stop, resume, restart, forget],
    );

    return <ChatChainRunsContext.Provider value={value}>{children}</ChatChainRunsContext.Provider>;
};
