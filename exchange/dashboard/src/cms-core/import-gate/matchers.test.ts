import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CRITICALITIES, criticalityRank, parseCategory, sortMatchers } from './matchers';

const category = (overrides: Record<string, unknown> = {}) => ({
    category: 'secrets',
    label: 'Credentials',
    criticality: 'critical',
    matchers: [{ label: 'AWS key', pattern: '\\bAKIA[0-9A-Z]{16}\\b' }],
    ...overrides,
});

describe('parseCategory', () => {
    beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
    afterEach(() => vi.restoreAllMocks());

    it('reads a matcher, and gives it the category it came from', () => {
        const [matcher] = parseCategory('secrets.json', category());

        expect(matcher.category).toBe('secrets');
        expect(matcher.categoryLabel).toBe('Credentials');
        expect(matcher.label).toBe('AWS key');
        expect(matcher.criticality).toBe('critical'); // inherited from the file
        expect('AKIAIOSFODNN7EXAMPLE'.match(matcher.regex)).toEqual(['AKIAIOSFODNN7EXAMPLE']);
    });

    it('lets a matcher be more, or less, serious than its category', () => {
        const parsed = parseCategory('secrets.json', category({
            matchers: [
                { label: 'certificate', pattern: 'BEGIN CERTIFICATE', criticality: 'medium' },
                { label: 'key', pattern: 'BEGIN PRIVATE KEY' },
            ],
        }));
        expect(parsed.map(m => m.criticality)).toEqual(['medium', 'critical']);
    });

    // The gate is matched over prose, where a capital is an accident of the sentence.
    it('matches without regard to case unless the matcher asks for it', () => {
        const [loose, strict] = parseCategory('x.json', category({
            matchers: [
                { label: 'loose', pattern: 'secret' },
                { label: 'strict', pattern: 'SECRET', caseSensitive: true },
            ],
        }));
        expect(loose.regex.test('Secret')).toBe(true);
        expect(strict.regex.test('Secret')).toBe(false);
    });

    // These files are hand-edited in a store that is in use. One bad rule must cost that rule.
    it('drops the rule it cannot understand and keeps the rest', () => {
        const parsed = parseCategory('secrets.json', category({
            matchers: [
                { label: 'unclosed group', pattern: '(unbalanced' },
                { label: 'sound', pattern: 'x' },
                { pattern: 'no label of its own' },
                'not an object at all',
                { label: 'also sound', pattern: 'ok' },
            ],
        }));
        expect(parsed.map(m => m.label)).toEqual(['sound', 'also sound']);
    });

    it('takes the category id from the file name when the document gives none', () => {
        const [matcher] = parseCategory('my-own-rules.json', category({ category: undefined, label: undefined }));
        expect(matcher.category).toBe('my-own-rules');
        expect(matcher.categoryLabel).toBe('my-own-rules');
    });

    // Switching a category off has to be easier than deleting it, or nobody will do either.
    it('honours enabled: false, on a file and on one rule', () => {
        expect(parseCategory('x.json', category({ enabled: false }))).toEqual([]);
        expect(parseCategory('x.json', category({
            matchers: [{ label: 'off', pattern: 'a', enabled: false }, { label: 'on', pattern: 'b' }],
        })).map(m => m.label)).toEqual(['on']);
    });

    it('survives a document that is not one', () => {
        expect(parseCategory('x.json', null)).toEqual([]);
        expect(parseCategory('x.json', [1, 2, 3])).toEqual([]);
        expect(parseCategory('x.json', { matchers: 'nope' })).toEqual([]);
    });

    // An unknown level would otherwise reach the stylesheet as a class that paints nothing.
    it('falls back to medium when a level is not one of the four', () => {
        const [matcher] = parseCategory('x.json', category({ criticality: 'catastrophic' }));
        expect(matcher.criticality).toBe('medium');
    });

    // Unicode mode is tried first, so a pattern that needs \p{...} works; one that only compiles
    // without it still gets in rather than being called invalid.
    it('compiles a Unicode-only pattern and a pattern Unicode mode refuses', () => {
        const parsed = parseCategory('x.json', category({
            matchers: [
                { label: 'unicode', pattern: '\\p{Lu}\\p{Ll}+' },
                { label: 'lenient', pattern: 'a{1' },
            ],
        }));
        expect(parsed.map(m => m.label)).toEqual(['unicode', 'lenient']);
        expect(parsed[0].regex.test('Édouard')).toBe(true);
        expect(parsed[1].regex.test('a{1')).toBe(true);
    });
});

describe('criticality', () => {
    it('orders worst first', () => {
        expect([...CRITICALITIES].sort((a, b) => criticalityRank(a) - criticalityRank(b)))
            .toEqual(['critical', 'high', 'medium', 'low']);
    });

    it('sorts the gate by level, then category, then rule', () => {
        const gate = sortMatchers([
            ...parseCategory('z.json', { category: 'z', label: 'Zed', criticality: 'low', matchers: [{ label: 'b', pattern: 'b' }] }),
            ...parseCategory('a.json', { category: 'a', label: 'Alpha', criticality: 'critical', matchers: [{ label: 'y', pattern: 'y' }, { label: 'x', pattern: 'x' }] }),
        ]);
        expect(gate.map(m => `${m.categoryLabel}/${m.label}`)).toEqual(['Alpha/x', 'Alpha/y', 'Zed/b']);
    });
});
