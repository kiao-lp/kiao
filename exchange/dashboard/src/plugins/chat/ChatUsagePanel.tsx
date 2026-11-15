
import React, { useEffect, useState } from 'react';
import { Progress } from 'antd';
import type { HarnessUsage, HarnessUsageWindow } from 'kiao-worker';
import { formatLocalDateTime } from '@kiao-dashboard-kit/date-time';

// Usage at or above this percent uses the warning state.
const HIGH_PERCENT = 90;

const LOADING_TEXT = 'Loading usage…';
const NOT_READ_TEXT = 'Refresh to load usage';
const UNAVAILABLE_TEXT = 'Usage unavailable';

const windowLabel = (minutes: number): string => {
    if (!minutes || minutes <= 0) return 'Limit';
    if (minutes % (24 * 60) === 0) return `Limit ${minutes / (24 * 60)}d`;
    if (minutes % 60 === 0) return `Limit ${minutes / 60}h`;
    return `Limit ${minutes} min`;
};

const windowKey = (window: HarnessUsageWindow, index: number) => `${window.windowMinutes}-${index}`;

const elapsedPercent = (window: HarnessUsageWindow, now: number): number | null => {
    const duration = window.windowMinutes * 60_000;
    const reset = window.resetAtEpochSeconds * 1000;
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(reset) || reset <= 0) return null;
    return Math.max(0, Math.min(100, (now - (reset - duration)) / duration * 100));
};

const UsageBar: React.FC<{ window: HarnessUsageWindow; now: number }> = ({ window, now }) => {
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
                        : `${label}, ${Math.round(timePercent)}% of the period elapsed`}
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

export const ChatUsagePanel: React.FC<{
    usage: HarnessUsage | null;
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

    // Keep the last known figures after a failed refresh.
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
