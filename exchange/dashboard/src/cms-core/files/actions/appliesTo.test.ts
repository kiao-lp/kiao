import { describe, expect, it } from 'vitest';
import { actionApplies } from './appliesTo';

/**
 * The same table as `TestActionApplies` in `operation/worker/actions_test.go`. The rule is
 * evaluated on both sides of the wire, so the two tables are meant to be read side by side: a case
 * added here belongs there too.
 */
describe('actionApplies', () => {
    const cases: [string, Parameters<typeof actionApplies>[0], string, boolean, boolean][] = [
        ['empty rule matches anything', {}, 'a/b.md', false, true],
        ['empty rule matches a directory', {}, 'a/b', true, true],
        ['a missing rule matches anything', undefined, 'a/b.md', false, true],
        ['extension matches', { extensions: ['.ttst.md'] }, 'u/x.ttst.md', false, true],
        ['extension is case-insensitive', { extensions: ['.ttst.md'] }, 'u/X.TTST.MD', false, true],
        ['plain markdown is not a ttst script', { extensions: ['.ttst.md'] }, 'u/x.md', false, false],
        ['compound extension wins over its tail', { extensions: ['.mlunit.json'] }, 'u/x.mlunit.json', false, true],
        ['other json is not a unit', { extensions: ['.mlunit.json'] }, 'u/x.config.json', false, false],
        ['any of several extensions', { extensions: ['.md', '.txt'] }, 'u/x.txt', false, true],
        ['directory required, file given', { directory: true }, 'u/x.md', false, false],
        ['directory required, directory given', { directory: true }, 'u', true, true],
        ['file required, directory given', { directory: false }, 'u', true, false],
        ['rules are AND-ed', { extensions: ['.md'], directory: true }, 'u/x.md', false, false],
        ['a folder named like an extension does not match by path', { extensions: ['.md'] }, 'x.md/child.json', false, false],
    ];

    it.each(cases)('%s', (_name, rule, path, isDirectory, expected) => {
        expect(actionApplies(rule, { path, isDirectory })).toBe(expected);
    });
});
