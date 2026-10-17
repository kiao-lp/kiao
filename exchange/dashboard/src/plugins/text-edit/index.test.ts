import { describe, expect, it } from 'vitest';
import { plugin } from './index';

const file = (path: string) => ({
    path,
    isDirectory: false,
    size: 0,
    lastModified: 0,
});

describe('TextEditor plugin', () => {
    it.each(['notes.txt', 'events.jsonl', 'article.cls'])('handles %s files', (path) => {
        expect(plugin.fileConfigFor(file(path))).not.toBeNull();
    });

    // It sits at the root of every store and is the operator's to edit; nothing else claims it.
    it('opens the store declaration, whose name is entirely its extension', () => {
        expect(plugin.fileConfigFor(file('.kiao-files'))).not.toBeNull();
        expect(plugin.fileConfigFor(file('docs/repo-a/.kiao-files'))).not.toBeNull();
    });

    // The rename modal splits a name on these, and this one has no name apart from its extension.
    it('keeps the declaration out of the renameable extensions', () => {
        expect(plugin.fileExtensions).toEqual(['.txt', '.jsonl', '.cls']);
    });

    it('ignores unsupported file extensions', () => {
        expect(plugin.fileConfigFor(file('notes.json'))).toBeNull();
    });
});
