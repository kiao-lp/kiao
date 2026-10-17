/**
 * When a runner was last seen, as the panel reads it out.
 *
 * The store stamps it on every heartbeat — every fifteen seconds from a live runner — so the
 * interesting answers are all recent: **just now**, **minutes ago**, **hours ago**. Past a day it
 * reads as a date with the clock beside it, and a runner that never called in says **never**
 * rather than wearing a date nobody could place.
 *
 * The one line the card gives to it is the relative one; the exact moment is the tooltip's, in the
 * reader's own locale — see {@link lastSeenExact}.
 */

/** What a runner that never called its heartbeat in says: no date, and no confusion with one. */
export const NEVER_SEEN = 'Never seen';

/**
 * When the runner was last heard from, in one short line — "Last seen just now", "Last seen
 * 5 min ago", "Last seen 12 Sep 08:00". `at` is the wire's ISO moment, or absent for a runner
 * that never called in. `now` is the clock it is read against — the wall clock, unless a test
 * pins one.
 */
export const formatLastSeen = (at: string | undefined, now: number = Date.now()): string => {
    if (!at) return NEVER_SEEN;
    const seen = new Date(at).getTime();
    if (Number.isNaN(seen)) return NEVER_SEEN;
    const ahead = seen - now;
    // A heartbeat stamped seconds in the future is a clock that disagrees by seconds, not a runner
    // from tomorrow: within the minute it reads as just now, past it as the date it says.
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

/**
 * The exact moment, for the tooltip: the date, the clock and the seconds, in the reader's own
 * locale — or the never-seen line where there is no moment to show.
 */
export const lastSeenExact = (at: string | undefined): string => {
    if (!at) return NEVER_SEEN;
    const seen = new Date(at).getTime();
    if (Number.isNaN(seen)) return NEVER_SEEN;
    return new Date(seen).toLocaleString([], {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
};
