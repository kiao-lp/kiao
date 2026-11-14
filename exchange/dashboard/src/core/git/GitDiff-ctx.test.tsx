import React from 'react';
import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { GitDiffProvider, useGitDiff } from './GitDiff-ctx';

/**
 * The diff target and the working-tree pane's draft. The target is the file the git panel opened
 * the diff on; the draft is what the pane had typed when its area went away — held above the
 * layout, so a remount restores it.
 */

let value!: ReturnType<typeof useGitDiff>;

const Probe: React.FC = () => {
    value = useGitDiff();
    return null;
};

const setup = () => render(<GitDiffProvider><Probe /></GitDiffProvider>);

describe('GitDiff target and draft', () => {
    it('opens on a file and closes back to nothing', () => {
        setup();

        act(() => value.openDiff('notes.md', ''));
        expect(value.diffTarget).toEqual({ path: 'notes.md', folder: '', root: '' });

        act(() => value.closeDiff());
        expect(value.diffTarget).toBeNull();
    });

    it('keeps the repository root with the target', () => {
        setup();

        act(() => value.openDiff('file.md', 'sub', 'nested/repo'));
        expect(value.diffTarget).toEqual({ path: 'file.md', folder: 'sub', root: 'nested/repo' });
    });

    it('keeps the draft when the file already open is opened again', () => {
        setup();
        act(() => value.openDiff('notes.md', ''));

        act(() => value.storeDraft('base', 'base with edits'));
        act(() => value.openDiff('notes.md', ''));

        expect(value.readDraft('base')).toBe('base with edits');
    });

    it('drops the draft when another file is opened', () => {
        setup();
        act(() => value.openDiff('notes.md', ''));
        act(() => value.storeDraft('base', 'base with edits'));

        act(() => value.openDiff('other.md', ''));

        expect(value.readDraft('base')).toBeNull();
    });

    it('drops the draft on close: reopening reads fresh', () => {
        setup();
        act(() => value.openDiff('notes.md', ''));
        act(() => value.storeDraft('base', 'base with edits'));

        act(() => value.closeDiff());
        act(() => value.openDiff('notes.md', ''));

        expect(value.readDraft('base')).toBeNull();
    });

    it('reads a draft against a moved base as nothing, and drops it', () => {
        setup();
        act(() => value.storeDraft('base', 'base with edits'));

        // The tree moved under the draft — a revert, a save elsewhere — so what was typed was
        // against other lines.
        expect(value.readDraft('moved')).toBeNull();
        // And the stale draft is gone rather than lingering for a base that matches nothing.
        expect(value.readDraft('base')).toBeNull();
    });
});
