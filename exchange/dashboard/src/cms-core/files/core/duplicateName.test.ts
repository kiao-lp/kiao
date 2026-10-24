import { describe, it, expect } from 'vitest';
import { duplicateItemsIn, duplicateName, duplicatePath } from './duplicateName';

const EXTENSIONS = ['.mmap.json', '.mlunit.json', '.md', '.json', '.png'];

describe('duplicateName', () => {
    it('puts a number between the name and its extension', () => {
        expect(duplicateName('notes.md', [], EXTENSIONS)).toBe('notes 1.md');
    });

    it('keeps a compound extension a plugin declared intact', () => {
        expect(duplicateName('plan.mmap.json', [], EXTENSIONS)).toBe('plan 1.mmap.json');
    });

    it('falls back to the last dot for an extension no plugin claims', () => {
        expect(duplicateName('archive.zip', [], EXTENSIONS)).toBe('archive 1.zip');
    });

    it('appends the number when the name has no extension', () => {
        expect(duplicateName('drafts', [], EXTENSIONS)).toBe('drafts 1');
    });

    it('treats a dotfile as a name rather than a bare extension', () => {
        expect(duplicateName('.gitignore', [], EXTENSIONS)).toBe('.gitignore 1');
    });

    it('takes the first number the folder leaves free', () => {
        expect(duplicateName('notes.md', ['notes.md', 'notes 1.md', 'notes 2.md'], EXTENSIONS))
            .toBe('notes 3.md');
    });

    it('counts on from a name that is already numbered', () => {
        expect(duplicateName('notes 1.md', ['notes.md', 'notes 1.md'], EXTENSIONS))
            .toBe('notes 2.md');
    });

    it('does not read digits glued to the name as a number of its own', () => {
        expect(duplicateName('report2024.md', [], EXTENSIONS)).toBe('report2024 1.md');
    });
});

describe('duplicatePath', () => {
    it('lands the duplicate in the source folder', () => {
        expect(duplicatePath('docs/guide/notes.md', ['docs/guide/notes.md'], EXTENSIONS))
            .toBe('docs/guide/notes 1.md');
    });

    it('handles a file sitting at the store root', () => {
        expect(duplicatePath('notes.md', ['notes.md'], EXTENSIONS)).toBe('notes 1.md');
    });

    it('compares against sibling names, not their paths', () => {
        expect(duplicatePath('docs/notes.md', ['docs/notes.md', 'docs/notes 1.md'], EXTENSIONS))
            .toBe('docs/notes 2.md');
    });
});

describe('duplicateItemsIn', () => {
    it('numbers a selection apart rather than aiming two entries at one name', () => {
        expect(duplicateItemsIn(['docs/a.md', 'docs/b.md'], ['docs/a.md', 'docs/b.md'], EXTENSIONS))
            .toEqual([
                { from: 'docs/a.md', to: 'docs/a 1.md' },
                { from: 'docs/b.md', to: 'docs/b 1.md' },
            ]);
    });

    it('counts a duplicate of a numbered sibling on from the one just taken', () => {
        expect(duplicateItemsIn(['docs/a.md', 'docs/a 1.md'], ['docs/a.md', 'docs/a 1.md'], EXTENSIONS))
            .toEqual([
                { from: 'docs/a.md', to: 'docs/a 2.md' },
                { from: 'docs/a 1.md', to: 'docs/a 3.md' },
            ]);
    });
});
