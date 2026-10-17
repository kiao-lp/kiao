import { describe, it, expect } from 'vitest';
import {
    formatBytes, formatCount, formatDuration, formatExtent, formatLength, formatPixels, formatShare,
} from './format';

describe('formatBytes', () => {
    it('names the unit a reader would use for that weight', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(900)).toBe('900 B');
        expect(formatBytes(2048)).toBe('2 kB');
        expect(formatBytes(1024 * 1024 * 3.5)).toBe('3.5 MB');
        expect(formatBytes(1024 ** 3 * 1.25)).toBe('1.25 GB');
    });

    it('has an answer for a number that is not one', () => {
        expect(formatBytes(Number.NaN)).toBe('—');
        expect(formatBytes(-1)).toBe('—');
    });
});

describe('formatCount', () => {
    it('leaves a small count alone and groups a large one', () => {
        expect(formatCount(0)).toBe('0');
        expect(formatCount(9999)).toBe('9999');
        // A narrow no-break space: it groups without wrapping, and means the same in every language.
        expect(formatCount(10000)).toBe('10 000');
        expect(formatCount(1234567)).toBe('1 234 567');
    });
});

describe('formatLength', () => {
    it('chooses the unit that makes a model scale legible', () => {
        expect(formatLength(0.004)).toBe('4.0 mm');
        expect(formatLength(0.62)).toBe('62.0 cm');
        expect(formatLength(1.83)).toBe('1.83 m');
        expect(formatLength(4200)).toBe('4.20 km');
    });

    it('writes the three sides of a box in one line', () => {
        expect(formatExtent([1.83, 0.62, 0.71])).toBe('1.83 m × 62.0 cm × 71.0 cm');
    });
});

describe('formatDuration', () => {
    it('reads a clip the way one would say it', () => {
        expect(formatDuration(0)).toBe('0 s');
        expect(formatDuration(2.5)).toBe('2.5 s');
        expect(formatDuration(1.333333)).toBe('1.33 s');
        expect(formatDuration(64)).toBe('1 min 04 s');
    });
});

describe('formatPixels', () => {
    it('counts texture memory in the millions it is paid in', () => {
        expect(formatPixels(0)).toBe('—');
        expect(formatPixels(64 * 64)).toBe('4 kpx');
        expect(formatPixels(2048 * 2048)).toBe('4.2 Mpx');
    });
});

describe('formatShare', () => {
    it('rounds to the percent, but never rounds a visible line down to nothing', () => {
        expect(formatShare(0, 100)).toBe('0%');
        expect(formatShare(1, 1000)).toBe('<1%');
        expect(formatShare(336, 1000)).toBe('34%');
        expect(formatShare(10, 0)).toBe('0%');
    });
});
