import { describe, it, expect } from 'vitest';
import { Criticality, GateMatcher, parseCategory } from './matchers';
import {
    MAX_SCAN_CHARS,
    OBFUSCATED,
    countByCriticality,
    findingLabel,
    redactFinding,
    scanText,
    segmentText,
    stepIndex,
} from './scan';

/** A one-rule gate, so a test says exactly what it is matching on. */
const rule = (label: string, pattern: string, criticality: Criticality = 'high'): GateMatcher =>
    parseCategory(`${label}.json`, {
        category: label, label: `The ${label} category`, criticality, matchers: [{ label, pattern }],
    })[0];

describe('scanText', () => {
    it('finds every occurrence, in reading order, with its offsets', () => {
        const { findings } = scanText('one AKIA1234567890123456 two AKIAABCDEFGHIJKLMNOP', [
            rule('aws', '\\bAKIA[0-9A-Z]{16}\\b', 'critical'),
        ]);

        expect(findings.map(f => [f.start, f.end, f.text])).toEqual([
            [4, 24, 'AKIA1234567890123456'],
            [29, 49, 'AKIAABCDEFGHIJKLMNOP'],
        ]);
        expect(findingLabel(findings[0])).toBe('The aws category · aws');
    });

    it('runs every rule of the gate over the same text', () => {
        const { findings } = scanText('claire@example.org lives at 10.0.0.4', [
            rule('email', '\\b\\S+@\\S+\\.\\w+\\b', 'medium'),
            rule('ip', '\\b10(?:\\.\\d{1,3}){3}\\b', 'high'),
        ]);
        expect(findings.map(f => f.matcher.label)).toEqual(['email', 'ip']);
    });

    // Two rules routinely claim the same characters. The highlight is one colour, so one wins —
    // and it has to be the one that says the worse thing, or a leaked key hides under a keyword.
    it('keeps the more critical of two findings that start together', () => {
        const text = 'password: hunter2';
        const { findings } = scanText(text, [
            rule('mention', 'password', 'low'),
            rule('assignment', 'password: \\S+', 'critical'),
        ]);
        expect(findings).toHaveLength(1);
        expect(findings[0].matcher.label).toBe('assignment');
    });

    it('drops a finding that starts inside one already kept', () => {
        const { findings } = scanText('token=eyJhbGciOi', [
            rule('assignment', 'token=\\S+', 'critical'),
            rule('jwt', 'eyJ\\w+', 'critical'),
        ]);
        expect(findings.map(f => f.matcher.label)).toEqual(['assignment']);
    });

    // A pattern that can match the empty string would otherwise never advance: the exec loop would
    // return the same zero-length match for as long as anyone waited.
    it('cannot be hung by a pattern that matches nothing at all', () => {
        const { findings } = scanText('abc', [rule('empty', 'x*')]);
        expect(findings).toEqual([]);
    });

    // The matchers are the store's gate: one object, reused for every document of the upload.
    it('leaves no state on a matcher between two documents', () => {
        const gate = [rule('a', 'a')];
        expect(scanText('aaa', gate).findings).toHaveLength(3);
        expect(scanText('aaa', gate).findings).toHaveLength(3);
    });

    it('stops at the length it will read, and says so', () => {
        const text = 'x'.repeat(MAX_SCAN_CHARS) + ' AKIA1234567890123456';
        const { findings, truncated } = scanText(text, [rule('aws', '\\bAKIA[0-9A-Z]{16}\\b')]);
        expect(findings).toEqual([]);
        expect(truncated).toBe(true);
    });

    it('caps one over-broad rule rather than letting it fill the navigator', () => {
        const { findings, truncated } = scanText('a '.repeat(1000), [rule('everything', 'a')]);
        expect(findings.length).toBeLessThan(1000);
        expect(truncated).toBe(true);
    });

    it('is quiet on a document with nothing in it', () => {
        expect(scanText('nothing to see', [rule('aws', 'AKIA')])).toEqual({ findings: [], truncated: false });
        expect(scanText('anything at all', [])).toEqual({ findings: [], truncated: false });
    });
});

describe('segmentText', () => {
    it('cuts the text into plain runs and findings, covering it exactly', () => {
        const text = 'call 0612345678 now';
        const { findings } = scanText(text, [rule('phone', '\\b0[1-9]\\d{8}\\b')]);
        const segments = segmentText(text, findings);

        expect(segments.map(s => s.text)).toEqual(['call ', '0612345678', ' now']);
        expect(segments.map(s => s.index)).toEqual([undefined, 0, undefined]);
        expect(segments.map(s => s.text).join('')).toBe(text);
    });

    it('handles a finding at either end', () => {
        const text = 'AKIA1234567890123456';
        const { findings } = scanText(text, [rule('aws', '\\bAKIA[0-9A-Z]{16}\\b')]);
        expect(segmentText(text, findings).map(s => s.text)).toEqual([text]);
    });

    // The tail past the cap is shown, simply unsearched: a reader scrolling into it should find
    // the document there rather than the end of it.
    it('shows the whole text even when the scan stopped short', () => {
        const text = 'x'.repeat(MAX_SCAN_CHARS) + 'TAIL';
        const { findings } = scanText(text, [rule('none', 'zzz')]);
        expect(segmentText(text, findings).map(s => s.text).join('')).toBe(text);
    });
});

describe('countByCriticality', () => {
    it('counts each level, and names the ones with nothing in them', () => {
        const { findings } = scanText('AKIA1234567890123456 and 10.0.0.1 and 10.0.0.2', [
            rule('aws', '\\bAKIA[0-9A-Z]{16}\\b', 'critical'),
            rule('ip', '\\b10(?:\\.\\d{1,3}){3}\\b', 'high'),
        ]);
        expect(countByCriticality(findings)).toEqual({ critical: 1, high: 2, medium: 0, low: 0 });
    });
});

describe('stepIndex', () => {
    it('walks forward and back, and wraps at both ends', () => {
        expect(stepIndex(0, 3, 1)).toBe(1);
        expect(stepIndex(2, 3, 1)).toBe(0);
        expect(stepIndex(0, 3, -1)).toBe(2);
    });

    // Nothing selected yet: either button starts the walk, at the end it points at.
    it('starts at the first going forward and the last going back', () => {
        expect(stepIndex(-1, 3, 1)).toBe(0);
        expect(stepIndex(-1, 3, -1)).toBe(2);
    });

    it('stays nowhere when there is nothing to walk', () => {
        expect(stepIndex(-1, 0, 1)).toBe(-1);
    });
});

describe('redactFinding', () => {
    const gate = [rule('aws', '\\bAKIA[0-9A-Z]{16}\\b', 'critical')];

    it('replaces the finding, and nothing around it', () => {
        const text = 'the key AKIA1234567890123456 is in the header';
        const [finding] = scanText(text, gate).findings;

        expect(redactFinding(text, finding)).toBe(`the key ${OBFUSCATED} is in the header`);
    });

    it('cuts the occurrence it was given, not the first one', () => {
        const text = 'AKIA1234567890123456 then AKIAABCDEFGHIJKLMNOP';
        const [, second] = scanText(text, gate).findings;

        expect(redactFinding(text, second)).toBe(`AKIA1234567890123456 then ${OBFUSCATED}`);
    });

    // What the next scan sees is the point: the cut passage is gone from the document, and so from
    // the gate — that is what makes obfuscating a way *past* a finding and not a note about it.
    it('leaves nothing for the gate to find again', () => {
        const text = 'key AKIA1234567890123456 here';
        const [finding] = scanText(text, gate).findings;

        expect(scanText(redactFinding(text, finding), gate).findings).toEqual([]);
    });

    it('handles a finding at either end of the text', () => {
        const text = 'AKIA1234567890123456';
        const [finding] = scanText(text, gate).findings;
        expect(redactFinding(text, finding)).toBe(OBFUSCATED);
    });
});
