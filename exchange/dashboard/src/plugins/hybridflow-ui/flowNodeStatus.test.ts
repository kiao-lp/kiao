import { describe, it, expect } from 'vitest';
import { canPlay, canWorkOn, readStatus, STATUS_LABELS } from './flowNodeStatus';

describe('reading where a flow node stands', () => {
    it('reads the nine words it knows', () => {
        expect(readStatus('draft')).toBe('draft');
        expect(readStatus('ready')).toBe('ready');
        expect(readStatus('todo')).toBe('todo');
        expect(readStatus(' blocked ')).toBe('blocked');
        expect(readStatus('running')).toBe('running');
        expect(readStatus('waiting-refresh')).toBe('waiting-refresh');
        expect(readStatus(' interrupted ')).toBe('interrupted');
        expect(readStatus('done')).toBe('done');
        expect(readStatus(' error ')).toBe('error');
    });

    it('reads anything else as ready', () => {
        expect(readStatus(undefined)).toBe('ready');
        expect(readStatus('')).toBe('ready');
        expect(readStatus('on-hold')).toBe('ready');
        expect(readStatus(2)).toBe('ready');
        expect(readStatus({ status: 'done' })).toBe('ready');
    });

    it('names them in the order a flow node lives them', () => {
        expect(Object.entries(STATUS_LABELS)).toEqual([
            ['draft', 'Draft'], ['ready', 'Ready'], ['todo', 'To do'], ['blocked', 'Blocked'],
            ['running', 'In progress'], ['waiting-refresh', 'Waiting refresh'],
            ['interrupted', 'Interrupted'], ['done', 'Done'], ['error', 'Error'],
        ]);
    });
});

describe('what may be played', () => {
    it('plays a ready flow node', () => {
        expect(canPlay('ready')).toBe(true);
    });

    it('leaves every other flow node alone', () => {
        expect(canPlay('draft')).toBe(false);
        expect(canPlay('todo')).toBe(false);
        expect(canPlay('blocked')).toBe(false);
        expect(canPlay('running')).toBe(false);
        expect(canPlay('waiting-refresh')).toBe(false);
        expect(canPlay('interrupted')).toBe(false);
        expect(canPlay('done')).toBe(false);
        expect(canPlay('error')).toBe(false);
    });

    it('offers work on a human task that is to do or in progress', () => {
        expect(canWorkOn('todo')).toBe(true);
        expect(canWorkOn('running')).toBe(true);
        expect(canWorkOn('ready')).toBe(false);
        expect(canWorkOn('done')).toBe(false);
    });
});
