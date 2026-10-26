import { describe, it, expect } from 'vitest';
import type { DuplicateGroup, FileDto } from 'kiao-worker';
import {
    canKeepOnlyOne,
    choiceOf,
    chosenConsolidations,
    folderLabel,
    folderOf,
    foldersOf,
    formatSize,
    nameOf,
    namesOf,
    plannedWasted,
    presetChoice,
    removedBy,
    staysPut,
    targetOf,
    totalWasted,
} from './duplicatesModel';

const file = (path: string): FileDto => ({ path, isDirectory: false, size: 10, lastModified: 0 });

const group = (hash: string, paths: string[], wasted = 10): DuplicateGroup =>
    ({ hash, size: 10, wasted, files: paths.map(file) });

describe('where a copy is and what it is called', () => {
    it('splits a store path into the folder holding it and the name it ends with', () => {
        expect(folderOf('units/abc/logo.png')).toBe('units/abc');
        expect(nameOf('units/abc/logo.png')).toBe('logo.png');
    });

    it('treats the store root as a folder like any other, with a name of its own to show', () => {
        expect(folderOf('logo.png')).toBe('');
        expect(nameOf('logo.png')).toBe('logo.png');
        expect(folderLabel('')).toBe('/');
    });
});

describe('what the radios are over', () => {
    // The whole reason the choice is folder-and-name rather than a row: two copies in one folder are
    // one location, so the location on offer is that folder once and not twice.
    it('offers each distinct folder once, however many copies sit in it', () => {
        const files = [file('a/one.png'), file('a/two.png'), file('b/one.png')];
        expect(foldersOf(files)).toEqual(['a', 'b']);
    });

    it('offers each distinct name once, however many copies bear it', () => {
        const files = [file('a/one.png'), file('a/two.png'), file('b/one.png')];
        expect(namesOf(files)).toEqual(['one.png', 'two.png']);
    });
});

describe('what a group answers by itself', () => {
    it('checks the location when every copy is in the same folder, and leaves the name to choose', () => {
        expect(presetChoice([file('a/one.png'), file('a/two.png')])).toEqual({ folder: 'a' });
    });

    it('checks the name when every copy bears the same one, and leaves the location to choose', () => {
        expect(presetChoice([file('a/logo.png'), file('b/logo.png')])).toEqual({ name: 'logo.png' });
    });

    // The store root is a folder like any other, so every copy at the root is one location — and
    // the answer "" must survive being preset, as it survives being clicked.
    it('presets the store root as a location', () => {
        expect(presetChoice([file('one.png'), file('two.png')])).toEqual({ folder: '' });
    });

    it('presets nothing when both halves have more than one answer on offer', () => {
        expect(presetChoice([file('a/one.png'), file('b/two.png')])).toEqual({});
    });

    it('shows what the reader picked once they have picked, and the preset until then', () => {
        const g = group('h', ['a/one.png', 'a/two.png']);
        expect(choiceOf(g, {})).toEqual({ folder: 'a' });
        expect(choiceOf(g, { h: { folder: 'a', name: 'one.png' } })).toEqual({ folder: 'a', name: 'one.png' });
    });
});

describe('what would be kept', () => {
    it('puts the chosen folder and the chosen name together', () => {
        expect(targetOf({ folder: 'assets/img', name: 'logo.png' })).toBe('assets/img/logo.png');
    });

    it('keeps a file chosen for the store root at the root, with no leading slash', () => {
        expect(targetOf({ folder: '', name: 'logo.png' })).toBe('logo.png');
    });

    // Nothing is chosen by default, and the button's whole guard is that both halves were picked on
    // purpose — so half a choice is no choice.
    it('answers nothing until both halves are chosen', () => {
        expect(targetOf({ folder: 'a' })).toBeNull();
        expect(targetOf({ name: 'logo.png' })).toBeNull();
        expect(targetOf({})).toBeNull();
        expect(canKeepOnlyOne({ folder: 'a' })).toBe(false);
        expect(canKeepOnlyOne({ folder: 'a', name: 'logo.png' })).toBe(true);
    });

    // A folder of "" is a real answer, so the emptiness of the string must not read as "unanswered".
    it('lets the store root be a chosen location', () => {
        expect(canKeepOnlyOne({ folder: '', name: 'logo.png' })).toBe(true);
    });
});

describe('what would go', () => {
    const paths = ['a/logo.png', 'b/brand.png'];

    it('names every copy that is not already at the target', () => {
        expect(removedBy(paths, 'a/brand.png')).toEqual(['a/logo.png', 'b/brand.png']);
        expect(removedBy(paths, 'a/logo.png')).toEqual(['b/brand.png']);
    });

    it('says when one of the copies is already where it would be kept, and so stays put', () => {
        expect(staysPut(paths, 'a/logo.png')).toBe(true);
        expect(staysPut(paths, 'a/brand.png')).toBe(false);
    });
});

describe('the plan the one button runs', () => {
    const GROUPS = [
        group('h1', ['a/logo.png', 'b/logo.png'], 10),
        group('h2', ['c/note.md', 'd/memo.md'], 40),
    ];

    it('carries each answered group\'s copies and the one path they come down to', () => {
        const plan = chosenConsolidations(GROUPS, {
            h1: { folder: 'a', name: 'logo.png' },
            h2: { folder: 'c', name: 'memo.md' },
        });
        expect(plan).toEqual([
            { hash: 'h1', paths: ['a/logo.png', 'b/logo.png'], target: 'a/logo.png', wasted: 10 },
            { hash: 'h2', paths: ['c/note.md', 'd/memo.md'], target: 'c/memo.md', wasted: 40 },
        ]);
    });

    // The whole reason acting is over all the groups while answering stays in each of them: a group
    // whose reader has not finished is not an error to report, it is simply not acted on.
    // A preset half is half a choice like any other: the group answers what has no alternative,
    // and the plan still waits for the reader's click on the half that has one.
    it('does not put a group in the plan on its preset alone', () => {
        const sameFolder = group('h3', ['a/one.png', 'a/two.png']);
        expect(chosenConsolidations([sameFolder], {})).toEqual([]);
        expect(chosenConsolidations([sameFolder], { h3: { folder: 'a', name: 'two.png' } })[0].target)
            .toBe('a/two.png');
    });

    it('leaves out a group with only half a choice, and one with none', () => {
        const plan = chosenConsolidations(GROUPS, { h1: { folder: 'a' } });
        expect(plan).toEqual([]);
    });

    it('adds up what the plan alone gives back, not what the whole scan found', () => {
        const plan = chosenConsolidations(GROUPS, { h2: { folder: 'c', name: 'memo.md' } });
        expect(plannedWasted(plan)).toBe(40);
        expect(totalWasted(GROUPS)).toBe(50);
    });

    it('answers an empty plan with nothing to give back, rather than with a number', () => {
        expect(plannedWasted([])).toBe(0);
    });
});

describe('the numbers a reader is shown', () => {
    it('adds up what every group would give back', () => {
        expect(totalWasted([
            { hash: 'x', size: 100, wasted: 200, files: [] },
            { hash: 'y', size: 50, wasted: 50, files: [] },
        ])).toBe(250);
    });

    it('reads bytes the way a person does', () => {
        expect(formatSize(512)).toBe('512 B');
        expect(formatSize(2048)).toBe('2.0 KB');
        expect(formatSize(30 * 1024)).toBe('30 KB');
        expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');
    });
});
