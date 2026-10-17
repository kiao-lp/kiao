// ── The quota gauges ──────────────────────────────────────────────────────────
//
// One agent's account as labelled gauges: a bar per rolling window with the reset time spelled
// out under each. The usage panel shows one of these per agent, each under its own title with its
// own refresh — which is why this names no agent: whose account it is, is said beside it.
//
// ── how many gauges, and what they are called ──────────────────────────────────
//
// **However many the account has.** There were two, they were five hours and a week, and they were
// named in the payload. A Codex plan decides its own — a free one has a single thirty-day window —
// so what arrives is a list of windows each naming its own length in minutes, and the label is made
// here out of that. Which is the right place for it: the length is a fact about the account, and
// what to call it in French is not something a Go service should be deciding.

import React from 'react';
import { Progress } from 'antd';
import type { AgentUsage, AgentUsageWindow } from 'kiao-worker';

const resetFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
});

const formatReset = (epochSeconds: number) =>
    resetFormatter.format(new Date(epochSeconds * 1000));

/** Where a window stops being something to glance at and becomes something to act on. */
const HIGH_PERCENT = 90;

const LOADING_TEXT = "Chargement de l'usage…";
const NOT_READ_TEXT = "Actualisez pour lire l'usage";
const UNAVAILABLE_TEXT = 'Usage indisponible';

/**
 * What to call a window: its length, in the largest unit it comes out whole in. `5 h` and `7 j` are
 * the two a Claude subscription has; `30 j` is a free Codex plan's, and a plan with some third
 * window reads correctly without a line being added here.
 *
 * A window whose length the agent did not say gets the bare word: better an unnamed bar than one
 * labelled with a duration this client invented for it.
 */
const windowLabel = (minutes: number): string => {
    if (!minutes || minutes <= 0) return 'Limite';
    if (minutes % (24 * 60) === 0) return `Limite ${minutes / (24 * 60)} j`;
    if (minutes % 60 === 0) return `Limite ${minutes / 60} h`;
    return `Limite ${minutes} min`;
};

/**
 * Bars are keyed by their length, which is what tells two windows of one account apart and stays the
 * same across a re-read. Two windows of the same length would be a payload nobody sends; the index
 * is the tiebreak so that even then nothing is dropped.
 */
const windowKey = (window: AgentUsageWindow, index: number) => `${window.windowMinutes}-${index}`;

const UsageBar: React.FC<{ window: AgentUsageWindow }> = ({ window }) => {
    const status = window.percentUsed >= HIGH_PERCENT ? 'exception' : 'normal';
    return (
        <div className="chat-usage-row">
            <div className="chat-usage-row-main">
                <span className="chat-usage-label">{windowLabel(window.windowMinutes)}</span>
                <Progress
                    className="chat-usage-progress"
                    percent={window.percentUsed}
                    status={status}
                    size="small"
                />
            </div>
            <div className="chat-usage-reset">reset {formatReset(window.resetAtEpochSeconds)}</div>
        </div>
    );
};

/** One agent's usage gauges: the windows, or why there are none to show. */
export const ChatUsagePanel: React.FC<{
    usage: AgentUsage | null;
    loading: boolean;
    error: boolean;
}> = ({ usage, loading, error }) => {
    // Known figures are shown even when the read that should have replaced them failed: a quota does
    // not vanish because the service was briefly unreachable, and a stale number beats none.
    if (!usage || usage.windows.length === 0) {
        // Three silences, and they say different things: a read on its way, an account nobody has
        // asked about yet, and one that could not be read — the last being also what an account
        // with no window at all reads as.
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
                <UsageBar key={windowKey(window, index)} window={window} />
            ))}
        </div>
    );
};
