import { describe, it, expect } from 'vitest';
import { formatLastSeen, lastSeenExact, NEVER_SEEN } from './runnerSeen';

// Pinned at noon UTC, so the dates read the same in whichever zone the suite runs — the
// assertions on them match loosely, and the clock is only ever the test's own.
const NOON = Date.UTC(2026, 8, 12, 12, 0, 0);

describe('formatLastSeen', () => {
    it('says never where the runner never called in', () => {
        expect(formatLastSeen(undefined, NOON)).toBe(NEVER_SEEN);
        expect(formatLastSeen('', NOON)).toBe(NEVER_SEEN);
        expect(formatLastSeen('not a date', NOON)).toBe(NEVER_SEEN);
    });

    it('reads the last minute as just now', () => {
        expect(formatLastSeen(new Date(NOON - 15_000).toISOString(), NOON)).toBe('Last seen just now');
        expect(formatLastSeen(new Date(NOON).toISOString(), NOON)).toBe('Last seen just now');
    });

    it('reads a clock disagreeing by seconds as just now rather than as tomorrow', () => {
        expect(formatLastSeen(new Date(NOON + 30_000).toISOString(), NOON)).toBe('Last seen just now');
    });

    it('counts minutes, then hours', () => {
        expect(formatLastSeen(new Date(NOON - 5 * 60_000).toISOString(), NOON)).toBe('Last seen 5 min ago');
        expect(formatLastSeen(new Date(NOON - 59 * 60_000).toISOString(), NOON)).toBe('Last seen 59 min ago');
        expect(formatLastSeen(new Date(NOON - 3 * 60 * 60_000).toISOString(), NOON)).toBe('Last seen 3 h ago');
    });

    it('reads anything past a day as a date with the clock beside it', () => {
        const line = formatLastSeen(new Date(NOON - 3 * 24 * 60 * 60_000).toISOString(), NOON);
        // Loose twice over: the month is the locale's word for September, punctuation included,
        // and the clock is the locale's too — a 12-hour locale reads "Sep 9 02:00 PM" where a
        // 24-hour one reads "9 Sep 14:00", and both are the same right answer. What the line must
        // not carry is the seconds a countdown would have.
        expect(line).toMatch(/^Last seen .+ \d{1,2}:\d{2}/);
        expect(line).not.toMatch(/:\d\d:\d\d/);
    });
});

describe('lastSeenExact', () => {
    it('says never where there is no moment to show', () => {
        expect(lastSeenExact(undefined)).toBe(NEVER_SEEN);
        expect(lastSeenExact('not a date')).toBe(NEVER_SEEN);
    });

    it('names the date, the clock and the seconds', () => {
        expect(lastSeenExact(new Date(NOON).toISOString())).toMatch(/\d{2}:\d{2}:\d{2}/);
    });
});
