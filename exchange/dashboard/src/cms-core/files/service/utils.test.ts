import { describe, it, expect } from 'vitest';
import { renameSelectionRange } from './utils';

describe('renameSelectionRange', () => {
    it('selects only the base part before a known compound extension', () => {
        expect(renameSelectionRange('notes.mmap.json', ['.mmap.json']))
            .toEqual({ start: 0, end: 5 });
    });

    it('selects only the base part before a known simple extension', () => {
        expect(renameSelectionRange('photo.png', ['.png']))
            .toEqual({ start: 0, end: 5 });
    });

    it('selects the whole name when no known extension matches', () => {
        expect(renameSelectionRange('report.txt', ['.mmap.json', '.json']))
            .toEqual({ start: 0, end: 10 });
    });

    it('keeps a longer matching extension intact', () => {
        expect(renameSelectionRange('plan.fmat.json', ['.fmat.json']))
            .toEqual({ start: 0, end: 4 });
    });

    it('matches extensions case-insensitively', () => {
        expect(renameSelectionRange('PHOTO.JPG', ['.jpg']))
            .toEqual({ start: 0, end: 5 });
    });

    it('selects the whole name for an empty extension list', () => {
        expect(renameSelectionRange('notes.mmap.json', []))
            .toEqual({ start: 0, end: 15 });
    });
});
