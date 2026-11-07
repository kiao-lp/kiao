
import React, { useEffect, useState } from 'react';
import { Progress } from 'antd';
import type { AgentUsage, AgentUsageWindow } from 'kiao-worker';
import { formatLocalDateTime } from '@cms-kit/date-time';

/** Where a window stops being something to glance at and becomes something to act on. */
const HIGH_PERCENT = 90;

const LOADING_TEXT = "Chargement de l'usage…";
const NOT_READ_TEXT = "Actualisez pour lire l'usage";
const UNAVAILABLE_TEXT = 'Usage indisponible';

/** What to call a window: its length, in the largest unit it comes out whole in. */
const windowLabel = (minutes: number): string => {
    if (!minutes || minutes <= 0) return 'Limite';
    if (minutes % (24 * 60) === 0) return `Limite ${minutes / (24 * 60)} j`;
    if (minutes % 60 === 0) return `Limite ${minutes / 60} h`;
    return `Limite ${minutes} min`;
};

/** Bars are keyed by their length, which is what tells two windows of one account apart and stays. */
const windowKey = (window: AgentUsageWindow, index: number) => `${window.windowMinutes}-${index}`;

const elapsedPercent = (window: AgentUsageWindow, now: number): number | null => {
    const duration = window.windowMinutes * 60_000;
    const reset = window.resetAtEpochSeconds * 1000;
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(reset) || reset <= 0) return null;
    return Math.max(0, Math.min(100, (now - (reset - duration)) / duration * 100));
};

const UsageBar: React.FC<{ window: AgentUsageWindow; now: number }> = ({ window, now }) => {
    const status = window.percentUsed >= HIGH_PERCENT ? 'exception' : 'normal';
    const label = windowLabel(window.windowMinutes);
    const timePercent = elapsedPercent(window, now);
    return (
        <div className="chat-usage-row">
            <div className="chat-usage-row-main">
                <span className="chat-usage-label">{label}</span>
                <Progress
                    className="chat-usage-progress"
                    classNames={{ rail: timePercent === null ? undefined : 'chat-usage-time-rail' }}
                    styles={{ rail: timePercent === null ? undefined : {
                        '--chat-usage-time-position': `${timePercent}%`,
                    } as React.CSSProperties }}
                    aria-label={timePercent === null ? label
                        : `${label}, ${Math.round(timePercent)} % de la période écoulée`}
                    percent={window.percentUsed}
                    status={status}
                    size="small"
                />
            </div>
            <div className="chat-usage-reset">
                {window.resetAtEpochSeconds > 0
                    ? `reset ${formatLocalDateTime(window.resetAtEpochSeconds * 1000)}`
                    : 'Reset time unavailable'}
            </div>
        </div>
    );
};

/** One agent's usage gauges: the windows, or why there are none to show. */
export const ChatUsagePanel: React.FC<{
    usage: AgentUsage | null;
    loading: boolean;
    error: boolean;
}> = ({ usage, loading, error }) => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!usage?.windows.length) return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(timer);
    }, [usage]);

    // Known figures are shown even when the read that should have replaced them failed: a quota does not vanish because the service was.
    if (!usage || usage.windows.length === 0) {
        const said = loading && !error
            ? LOADING_TEXT
            : !usage && !error ? NOT_READ_TEXT : UNAVAILABLE_TEXT;
        return (
            <div className="chat-usage-panel chat-usage-panel--muted">
                {said}
            </div>
        );
    }
    return (
        <div className="chat-usage-panel">
            {usage.windows.map((window, index) => (
                <UsageBar key={windowKey(window, index)} window={window} now={now} />
            ))}
        </div>
    );
};
