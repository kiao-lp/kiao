import { describe, expect, it } from 'vitest';
import {
    EMPTY_VIEW_STATE,
    MAX_FILE_ENTRIES,
    SMALL_SCREEN_MAX_WIDTH,
    SMALL_SCREEN_VIEW_STATE_DOC,
    VIEW_STATE_DOC,
    ViewStateFile,
    dirtyKeyId,
    fileScope,
    folderScope,
    isUnchanged,
    mergeDirtyInto,
    normalizeViewState,
    pruneFiles,
    readValue,
    withFileScope,
    viewStateDocFor,
    withFolderScope,
    withGlobal,
} from './viewStateModel';

const doc = (files: ViewStateFile['files'] = {}, global: ViewStateFile['global'] = {}, folders: ViewStateFile['folders'] = {}): ViewStateFile =>
    ({ version: 1, global, folders, files });

describe('viewStateDocFor', () => {
    // A phone has room for one column and closes the rest; a desktop wants them back. Sharing a
    // document would have each screen undoing the other's layout on every visit.
    it('separates a phone from a desktop', () => {
        expect(viewStateDocFor(390)).toBe(SMALL_SCREEN_VIEW_STATE_DOC);
        expect(viewStateDocFor(1512)).toBe(VIEW_STATE_DOC);
        expect(SMALL_SCREEN_VIEW_STATE_DOC).not.toBe(VIEW_STATE_DOC);
    });

    // The breakpoint the stylesheets lay out for, so the document and the layout it describes agree.
    it('counts the breakpoint itself as the small screen', () => {
        expect(viewStateDocFor(SMALL_SCREEN_MAX_WIDTH)).toBe(SMALL_SCREEN_VIEW_STATE_DOC);
        expect(viewStateDocFor(SMALL_SCREEN_MAX_WIDTH + 1)).toBe(VIEW_STATE_DOC);
    });
});

describe('normalizeViewState', () => {
    it('keeps the three sections of a well-formed file', () => {
        const raw = { version: 1, global: { theme: 'light' }, folders: { units: { fileBrowser: { viewMode: 'grid' } } }, files: { 'a.md': { at: 5 } } };
        expect(normalizeViewState(raw)).toEqual(raw);
    });

    // The file is git-tracked and hand-editable, so anything can turn up in it.
    it.each([null, undefined, 'nonsense', 42, []])('degrades to empty for %s', (raw) => {
        expect(normalizeViewState(raw)).toEqual(EMPTY_VIEW_STATE);
    });

    it('replaces a section that is not an object', () => {
        expect(normalizeViewState({ version: 1, global: 'oops', folders: null, files: [] }))
            .toEqual(EMPTY_VIEW_STATE);
    });
});

describe('reading a scope', () => {
    it('returns the defaults when the file has no entry', () => {
        expect(fileScope(doc(), 'a.md', 'markdown', { showPreview: true })).toEqual({ showPreview: true });
    });

    // Adding an option to a plugin must not invalidate what is already stored.
    it('merges a partial stored scope over the defaults', () => {
        const d = doc({ 'a.md': { markdown: { showPreview: false } } });
        expect(fileScope(d, 'a.md', 'markdown', { showPreview: true, syncScroll: true }))
            .toEqual({ showPreview: false, syncScroll: true });
    });

    it('ignores a stored scope that is not an object', () => {
        const d = doc({ 'a.md': { markdown: 7 as any } });
        expect(fileScope(d, 'a.md', 'markdown', { showPreview: true })).toEqual({ showPreview: true });
    });

    it('reads folder scopes and plain global values', () => {
        const d = doc({}, { theme: 'light' }, { units: { fileBrowser: { viewMode: 'grid' } } });
        expect(folderScope(d, 'units', 'fileBrowser', { viewMode: 'details' })).toEqual({ viewMode: 'grid' });
        expect(readValue(d.global, 'theme', 'dark')).toBe('light');
        expect(readValue(d.global, 'voiceLanguage', 'en-US')).toBe('en-US');
    });
});

describe('writing', () => {
    it('stamps the access time of the file it touches', () => {
        const next = withFileScope(doc(), 'a.md', 'markdown', { showPreview: false }, 1234);
        expect(next.files['a.md']).toEqual({ at: 1234, markdown: { showPreview: false } });
    });

    it('leaves the other scopes of the same file alone', () => {
        const start = withFileScope(doc(), 'a.md', 'markdown', { showPreview: false }, 1);
        const next = withFileScope(start, 'a.md', 'pdf', { pageNumber: 4 }, 2);
        expect(next.files['a.md']).toEqual({ at: 2, markdown: { showPreview: false }, pdf: { pageNumber: 4 } });
    });

    it('does not mutate the document it is given', () => {
        const start = doc();
        withGlobal(withFolderScope(start, 'units', 'fileBrowser', { viewMode: 'grid' }), 'theme', 'light');
        expect(start).toEqual(doc());
    });
});

describe('isUnchanged', () => {
    // Every write reaches a git-tracked file; a no-op must not produce a diff.
    it('sees an equal scope as unchanged whatever the key order', () => {
        expect(isUnchanged({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
        expect(isUnchanged({ a: 1 }, { a: 2 })).toBe(false);
        expect(isUnchanged(undefined, { a: 1 })).toBe(false);
    });
});

describe('pruneFiles', () => {
    const many = (n: number): ViewStateFile => {
        const files: ViewStateFile['files'] = {};
        for (let i = 0; i < n; i++) files[`f${i}.md`] = { at: i };
        return doc(files);
    };

    it('leaves a document under the cap untouched', () => {
        const d = many(10);
        expect(pruneFiles(d)).toBe(d);
    });

    it('keeps the most recently accessed entries', () => {
        const pruned = pruneFiles(many(MAX_FILE_ENTRIES + 20));
        const kept = Object.keys(pruned.files);
        expect(kept).toHaveLength(MAX_FILE_ENTRIES);
        expect(kept).toContain(`f${MAX_FILE_ENTRIES + 19}.md`);
        expect(kept).not.toContain('f0.md');
    });

    it('drops unstamped entries first', () => {
        const pruned = pruneFiles(doc({ old: {}, fresh: { at: 1 } }), 1);
        expect(Object.keys(pruned.files)).toEqual(['fresh']);
    });
});

describe('mergeDirtyInto', () => {
    // Unit content opens in new browser tabs, so several tabs write this file and
    // worker has no ETag. Only what this tab touched may be pushed back.
    it('keeps another tab\'s scope and applies only our own', () => {
        const remote = doc({ 'other.md': { at: 1, markdown: { showPreview: false } } });
        const local = doc({ 'mine.md': { at: 2, markdown: { showPreview: true } } });

        const merged = mergeDirtyInto(remote, local, [{ section: 'files', path: 'mine.md', key: 'markdown' }], 9);

        expect(merged.files['other.md']).toEqual({ at: 1, markdown: { showPreview: false } });
        expect(merged.files['mine.md']).toEqual({ at: 9, markdown: { showPreview: true } });
    });

    it('does not push back a scope we never touched', () => {
        const remote = doc({ 'a.md': { at: 1, markdown: { showPreview: false } } });
        const local = doc({ 'a.md': { at: 2, markdown: { showPreview: true }, pdf: { pageNumber: 4 } } });

        const merged = mergeDirtyInto(remote, local, [{ section: 'files', path: 'a.md', key: 'pdf' }], 9);

        expect(merged.files['a.md'].markdown).toEqual({ showPreview: false });
        expect(merged.files['a.md'].pdf).toEqual({ pageNumber: 4 });
    });

    it('merges global and folder sections too', () => {
        const remote = doc({}, { voiceLanguage: 'fr-FR' });
        const local = doc({}, { theme: 'light' }, { units: { fileBrowser: { viewMode: 'grid' } } });

        const merged = mergeDirtyInto(remote, local, [
            { section: 'global', key: 'theme' },
            { section: 'folders', path: 'units', key: 'fileBrowser' },
        ], 9);

        expect(merged.global).toEqual({ voiceLanguage: 'fr-FR', theme: 'light' });
        expect(merged.folders.units).toEqual({ fileBrowser: { viewMode: 'grid' } });
    });

    it('prunes the merged result', () => {
        const files: ViewStateFile['files'] = {};
        for (let i = 0; i < MAX_FILE_ENTRIES + 5; i++) files[`f${i}.md`] = { at: i };
        const merged = mergeDirtyInto(doc(files), doc(), [], 9);
        expect(Object.keys(merged.files)).toHaveLength(MAX_FILE_ENTRIES);
    });

    it('gives each dirty scope a distinct identity', () => {
        expect(dirtyKeyId({ section: 'global', key: 'theme' })).toBe('global:theme');
        expect(dirtyKeyId({ section: 'files', path: 'a.md', key: 'markdown' })).toBe('files:a.md:markdown');
        expect(dirtyKeyId({ section: 'folders', path: 'a.md', key: 'markdown' }))
            .not.toBe(dirtyKeyId({ section: 'files', path: 'a.md', key: 'markdown' }));
    });
});
