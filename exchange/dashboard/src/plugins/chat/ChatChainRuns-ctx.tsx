
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { message } from 'antd';
import type { HarnessChainRunNotice, HarnessChainRun } from 'kiao-worker';
import { useWorkerClient, useDashboardConfig } from '@kiao-dashboard-core';
import { localizeNoticeDateTimes } from '@kiao-dashboard-kit/date-time';
import { useChatSocketContext } from './ChatSocket-ctx';

export interface ChatChainRunsValue {

    runs: HarnessChainRun[];

    play: (path: string, flowNodeId: string, name: string) => void;

    stop: (runId: string) => void;

    resume: (runId: string) => Promise<void>;

    restart: (runId: string) => void;

    forget: (runId: string) => void;
}

const ChatChainRunsContext = createContext<ChatChainRunsValue | null>(null);

export const useChatChainRuns = (): ChatChainRunsValue => {
    const ctx = useContext(ChatChainRunsContext);
    if (!ctx) throw new Error('useChatChainRuns must be used within a ChatChainRunsProvider');
    return ctx;
};

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** What a notice is said as. */
const say = (notice: HarnessChainRunNotice) => {
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
    const [runs, setRuns] = useState<HarnessChainRun[]>([]);

    const watching = chatEnabled;

    useEffect(() => {
        if (!watching) return;
        return onChainRun(frame => {
            setRuns(frame.runs ?? []);
            if (frame.notice) say(frame.notice);
        });
    }, [watching, onChainRun]);

    useEffect(() => {
        if (!watching) return;
        return onHello(hello => setRuns(hello.chainRuns ?? []));
    }, [watching, onHello]);

    useEffect(() => {
        if (!watching) return;
        let dropped = false;
        client.getChainRuns()
            .then(current => { if (!dropped) setRuns(current); })
            .catch(error => console.error('Failed to read the chain runs', error));
        return () => { dropped = true; };
    }, [watching, client]);

    const play = useCallback((path: string, flowNodeId: string, name: string) => {
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
