/** When a runner was last seen, as the panel reads it out. */

/** What a runner that never called its heartbeat in says: no date, and no confusion with one. */
export const NEVER_SEEN = 'Never seen';

/** When the runner was last heard from, in one short line — "Last seen just now", "Last seen 5 min. */
export const formatLastSeen = (at: string | undefined, now: number = Date.now()): string => {
    if (!at) return NEVER_SEEN;
    const seen = new Date(at).getTime();
    if (Number.isNaN(seen)) return NEVER_SEEN;
    const ahead = seen - now;

    if (ahead > 60_000) return `Last seen ${seenDate(seen)}`;
    const ago = Math.max(now - seen, 0);
    if (ago < 60_000) return 'Last seen just now';
    if (ago < 60 * 60_000) {
        const minutes = Math.floor(ago / 60_000);
        return `Last seen ${minutes} min ago`;
    }
    if (ago < 24 * 60 * 60_000) {
        const hours = Math.floor(ago / (60 * 60_000));
        return `Last seen ${hours} h ago`;
    }
    return `Last seen ${seenDate(seen)}`;
};

/** The moment as a date with the clock beside it: what anything past a day reads as. */
const seenDate = (seen: number): string => {
    const at = new Date(seen);
    return `${at.toLocaleDateString([], { day: 'numeric', month: 'short' })} `
        + at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/** The exact moment, for the tooltip: the date, the clock and the seconds, in the reader's own locale. */
export const lastSeenExact = (at: string | undefined): string => {
    if (!at) return NEVER_SEEN;
    const seen = new Date(at).getTime();
    if (Number.isNaN(seen)) return NEVER_SEEN;
    return new Date(seen).toLocaleString([], {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
};
