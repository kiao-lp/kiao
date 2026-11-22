import { describe, expect, it } from 'vitest';
import { instantiationTargetOf } from './instantiationTarget';

describe('instantiationTargetOf', () => {
    it('writes the markdown next to the template, under the same name', () => {
        expect(instantiationTargetOf('templates/Prompt.temp.md')).toBe('templates/Prompt.md');
    });

    it('keeps a name made of several dotted parts', () => {
        expect(instantiationTargetOf('a/b/release.notes.temp.md')).toBe('a/b/release.notes.md');
    });

    it('has no target for a file that is not a template', () => {
        expect(instantiationTargetOf('templates/Prompt.md')).toBeNull();
        expect(instantiationTargetOf('templates/notes.txt')).toBeNull();
    });
});
