import { describe, expect, it } from 'vitest';
import { FileDto } from 'src/cms-core/files/service';
import { ROOT, buildRows, folderChain, foldersToLoad, isExpandable, withListing } from './fileTreeModel';

const dir = (path: string, childrenCount?: number): FileDto =>
    ({ path, isDirectory: true, size: 0, lastModified: 0, childrenCount });
const file = (path: string): FileDto => ({ path, isDirectory: false, size: 0, lastModified: 0 });

const opened = (...folders: string[]) => new Set([ROOT, ...folders]);

describe('folderChain', () => {
    it('walks from the root down to the folder', () =>
        expect(folderChain('units/fr/greetings')).toEqual([ROOT, 'units', 'units/fr', 'units/fr/greetings']));

    it('is the root alone for the root', () => expect(folderChain(ROOT)).toEqual([ROOT]));
});

describe('isExpandable', () => {
    it('opens a folder whose content is unknown', () => expect(isExpandable(dir('units'))).toBe(true));
    it('opens a folder with entries', () => expect(isExpandable(dir('units', 3))).toBe(true));
    it('leaves an empty folder without an expander', () => expect(isExpandable(dir('units', 0))).toBe(false));
    it('never opens a file', () => expect(isExpandable(file('notes.md'))).toBe(false));
});

describe('buildRows', () => {
    it('shows the root alone while nothing is loaded', () => {
        const rows = buildRows({}, opened());

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ path: ROOT, depth: 0, isRoot: true, expanded: true, expandable: true });
    });

    it('hides everything when the root is closed', () => {
        const rows = buildRows({ [ROOT]: [dir('units')] }, new Set<string>());

        expect(rows.map(row => row.path)).toEqual([ROOT]);
        expect(rows[0].expanded).toBe(false);
    });

    it('lists folders before files, each by name', () => {
        const rows = buildRows({ [ROOT]: [file('b.md'), dir('Zeta'), file('A.md'), dir('alpha')] }, opened());

        expect(rows.slice(1).map(row => row.path)).toEqual(['alpha', 'Zeta', 'A.md', 'b.md']);
    });

    it('indents an open branch under its folder', () => {
        const rows = buildRows({
            [ROOT]: [dir('units'), file('read.me')],
            units: [dir('units/fr'), file('units/index.md')],
            'units/fr': [file('units/fr/greetings.mlunit.json')],
        }, opened('units', 'units/fr'));

        expect(rows.map(row => [row.path, row.depth])).toEqual([
            [ROOT, 0],
            ['units', 1],
            ['units/fr', 2],
            ['units/fr/greetings.mlunit.json', 3],
            ['units/index.md', 2],
            ['read.me', 1],
        ]);
    });

    it('leaves what a closed branch holds out', () => {
        const rows = buildRows({
            [ROOT]: [dir('units')],
            units: [file('units/index.md')],
        }, opened());

        expect(rows.map(row => row.path)).toEqual([ROOT, 'units']);
    });

    it('gives an open folder still being read no children yet', () => {
        const rows = buildRows({ [ROOT]: [dir('units')] }, opened('units'));

        expect(rows.map(row => row.path)).toEqual([ROOT, 'units']);
        expect(rows[1].expanded).toBe(true);
    });
});

describe('foldersToLoad', () => {
    it('asks for the root before anything is known', () =>
        expect(foldersToLoad(buildRows({}, opened()), {})).toEqual([ROOT]));

    it('asks for an open folder that has never been read', () => {
        const children = { [ROOT]: [dir('units'), dir('docs')] };

        expect(foldersToLoad(buildRows(children, opened('units')), children)).toEqual(['units']);
    });

    it('asks for nothing once every open folder is read', () => {
        const children = { [ROOT]: [dir('units')], units: [file('units/index.md')] };

        expect(foldersToLoad(buildRows(children, opened('units')), children)).toEqual([]);
    });

    it('ignores a folder remembered as open under a closed one', () => {
        const children = { [ROOT]: [dir('units')] };

        expect(foldersToLoad(buildRows(children, new Set([ROOT, 'units/fr'])), children)).toEqual([]);
    });
});

describe('withListing', () => {
    it('holds the folder that was just read', () => {
        const entries = [dir('units/fr')];

        expect(withListing({}, 'units', entries)).toEqual({ units: entries });
    });

    it('keeps the listings of folders elsewhere in the tree', () => {
        const held = { docs: [file('docs/read.me')] };

        expect(withListing(held, 'units', [])).toEqual({ ...held, units: [] });
    });

    // Deleting a folder with its branch open, and creating one of the same name afterwards,
    // would otherwise draw the children of the folder that is gone under the new one.
    it('drops the branch of a folder the new listing no longer holds', () => {
        const held = {
            units: [dir('units/fr'), dir('units/en')],
            'units/fr': [file('units/fr/index.md')],
            'units/en': [file('units/en/index.md')],
        };

        expect(withListing(held, 'units', [dir('units/en')])).toEqual({
            units: [dir('units/en')],
            'units/en': [file('units/en/index.md')],
        });
    });

    it('drops a top-level branch the root no longer holds', () => {
        const held = { [ROOT]: [dir('docs')], docs: [file('docs/read.me')] };

        expect(withListing(held, ROOT, [])).toEqual({ [ROOT]: [] });
    });
});
