import { describe, expect, it } from 'vitest';
import { quoteSearchTerm } from 'kiao-worker/utils';
import { applyTextEdit } from './files.js';

// quoteSearchTerm lives in kiao-worker, which has no test runner of its own; its contract is the
// worker query grammar, and getting it wrong silently inverts or splits a search.
describe('quoteSearchTerm', () => {
    it('wraps a literal so the grammar reads it as one exact-case phrase', () => {
        expect(quoteSearchTerm('abc')).toBe('"abc"');
        expect(quoteSearchTerm('two words')).toBe('"two words"');
        expect(quoteSearchTerm('-leading-hyphen')).toBe('"-leading-hyphen"'); // would be a negation bare
        expect(quoteSearchTerm('units/foo')).toBe('"units/foo"');
    });

    it('escapes the two characters the phrase form treats as syntax', () => {
        expect(quoteSearchTerm('say "hi"')).toBe('"say \\"hi\\""');
        expect(quoteSearchTerm('C:\\Users')).toBe('"C:\\\\Users"');
        expect(quoteSearchTerm('\\"')).toBe('"\\\\\\""');
    });
});

describe('applyTextEdit', () => {
    const text = 'alpha\n  beta: 1,\n  gamma: 2,\n  beta-like: 3\n';

    it('replaces a unique exact string once', () => {
        const res = applyTextEdit(text, '  gamma: 2,', '  gamma: 5,', false);
        expect(res.replacements).toBe(1);
        expect(res.text).toBe('alpha\n  beta: 1,\n  gamma: 5,\n  beta-like: 3\n');
    });

    it('rejects a non-unique string unless replaceAll, and counts occurrences in the error', () => {
        expect(() => applyTextEdit(text, 'beta', 'delta', false)).toThrow(/occurs 2 times/);
        const res = applyTextEdit(text, 'beta', 'delta', true);
        expect(res.replacements).toBe(2);
        expect(res.text).toContain('delta: 1');
        expect(res.text).toContain('delta-like: 3');
    });

    it('rejects a string that is absent, empty, or unchanged', () => {
        expect(() => applyTextEdit(text, 'nosuch', 'x', false)).toThrow(/not found/);
        expect(() => applyTextEdit(text, '', 'x', false)).toThrow(/must not be empty/);
        expect(() => applyTextEdit(text, 'alpha', 'alpha', false)).toThrow(/identical/);
    });

    it('handles multi-line replacements with exact whitespace', () => {
        const res = applyTextEdit(text, '  beta: 1,\n  gamma: 2,', '  merged: 3,', false);
        expect(res.text).toBe('alpha\n  merged: 3,\n  beta-like: 3\n');
    });
});
