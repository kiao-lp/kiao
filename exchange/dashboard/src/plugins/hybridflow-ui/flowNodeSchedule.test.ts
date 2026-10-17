import { describe, it, expect } from 'vitest';
import { hasSchedule, readSchedule, readDuration, scheduleLabel } from './flowNodeSchedule';

/**
 * A Scheduler's datetime is a **wall clock**: what a `datetime-local` box writes, with no zone on
 * the end, because the machine that will be woken is the one whose clock decides.
 */
describe('the datetime a document says', () => {
    it('keeps a local datetime as it is written', () => {
        expect(readSchedule('2026-09-03T22:00')).toBe('2026-09-03T22:00');
    });

    // The box is answered to the minute, and a hand-written board may say more than that.
    it('drops the seconds a hand-written board may carry', () => {
        expect(readSchedule('2026-09-03T22:00:30')).toBe('2026-09-03T22:00');
    });

    // Forgiving like every other reader here: what nobody can make sense of is nothing at all.
    it('reads anything that is not a local datetime as none', () => {
        expect(readSchedule('tonight')).toBe('');
        expect(readSchedule('2026-09-03')).toBe('');
        expect(readSchedule('2026-09-03T22:00Z')).toBe('');
        expect(readSchedule(1757016000000)).toBe('');
        expect(readSchedule(undefined)).toBe('');
    });

    it('is what says the card has a moment to wait for', () => {
        expect(hasSchedule('2026-09-03T22:00')).toBe(true);
        expect(hasSchedule('')).toBe(false);
        expect(hasSchedule('whenever')).toBe(false);
    });
});

describe('what the card reads out', () => {
    it('says the moment as a calendar and a clock do', () => {
        // The locale is the browser's, so this only asserts that the parts are in there.
        const said = scheduleLabel('2026-09-03T22:00');
        expect(said).toMatch(/22|10/);
        expect(said).toMatch(/3|03/);
    });

    it('says nothing where the card names no moment', () => {
        expect(scheduleLabel('')).toBe('');
    });
});


describe('fixed duration', () => {
    it('validates compound waits and rejects zero, negative, malformed or overflowing waits', () => {
        expect(readDuration(' 1h30m ')).toBe('1h30m');
        expect(readDuration('250ms')).toBe('250ms');
        for (const raw of ['0s', '-1m', '10', 'later', '999999999999h', '0.00000000001s']) {
            expect(readDuration(raw)).toBe('');
        }
    });
    it('offers a label and playability without a datetime', () => {
        expect(scheduleLabel('', '1h30m')).toBe('Wait 1h30m');
        expect(hasSchedule('', '1h30m')).toBe(true);
        expect(hasSchedule('', '0s')).toBe(false);
    });
});
