import { describe, it, expect } from 'vitest';
import { canPlay, readStatus, STATUS_LABELS } from './flowNodeStatus';

describe('reading where a flow node stands', () => {
    it('reads the eight words it knows', () => {
        expect(readStatus('draft')).toBe('draft');
        expect(readStatus('ready')).toBe('ready');
        expect(readStatus(' blocked ')).toBe('blocked');
        expect(readStatus('running')).toBe('running');
        expect(readStatus('waiting-refresh')).toBe('waiting-refresh');
        expect(readStatus(' interrupted ')).toBe('interrupted');
        expect(readStatus('done')).toBe('done');
        expect(readStatus(' error ')).toBe('error');
    });

    // Ready is what a flow node says by saying nothing, and reading is forgiving here as everywhere: a
    // document may have been hand-written, or written by a build that had a word this one has not.
    it('reads anything else as ready', () => {
        expect(readStatus(undefined)).toBe('ready');
        expect(readStatus('')).toBe('ready');
        expect(readStatus('on-hold')).toBe('ready');
        expect(readStatus(2)).toBe('ready');
        expect(readStatus({ status: 'done' })).toBe('ready');
    });

    // The select is drawn from this, and the order is the one a flow node goes through.
    it('names them in the order a flow node lives them', () => {
        expect(Object.entries(STATUS_LABELS)).toEqual([
            ['draft', 'Draft'], ['ready', 'Ready'], ['blocked', 'Blocked'],
            ['running', 'In progress'], ['waiting-refresh', 'Waiting refresh'],
            ['interrupted', 'Interrupted'], ['done', 'Done'], ['error', 'Error'],
        ]);
    });
});

describe('what may be played', () => {
    it('plays a ready flow node', () => {
        expect(canPlay('ready')).toBe(true);
    });

    // A play would write over the answer filed under a done flow node, over what a stopped turn managed
    // to say, and over the mark that says which flow node last night's run stopped on. All of it is what
    // the board is there to say — and a draft is a flow node still being asked, a blocked one is waiting
    // on something off the board, while a running one, or one held until a usage limit refreshes, is
    // a flow node some other run is holding.
    it('leaves every other flow node alone', () => {
        expect(canPlay('draft')).toBe(false);
        expect(canPlay('blocked')).toBe(false);
        expect(canPlay('running')).toBe(false);
        expect(canPlay('waiting-refresh')).toBe(false);
        expect(canPlay('interrupted')).toBe(false);
        expect(canPlay('done')).toBe(false);
        expect(canPlay('error')).toBe(false);
    });
});
