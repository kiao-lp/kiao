import { describe, it, expect } from 'vitest';
import { decideDiskChange } from './diskSync';

describe('decideDiskChange', () => {
    it('reloads a file that moved under an editor holding nothing unsaved', () => {
        expect(decideDiskChange('written by Claude', 'as opened', 'as opened')).toBe('reload');
    });

    it('reads a write of our own as in sync, however it arrives', () => {
        // The text reached the disk; whether it also reached `synced` yet is the race this covers.
        expect(decideDiskChange('typed here', 'typed here', 'typed here')).toBe('in-sync');
        expect(decideDiskChange('typed here', 'typed here', 'as opened')).toBe('in-sync');
    });

    it('keeps unsaved edits when the file moved too, and calls it a conflict', () => {
        expect(decideDiskChange('written by Claude', 'typed here', 'as opened')).toBe('conflict');
    });

    it('reads our own write landing under unsaved edits as in sync, not a conflict', () => {
        // The debounced write went out while the typing moved on: the file holds exactly what
        // was last handed to the writer, so nothing from outside moved it — the editor is only
        // dirty again.
        expect(decideDiskChange('as written', 'typed more', 'as written')).toBe('in-sync');
    });
});
