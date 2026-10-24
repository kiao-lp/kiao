import { describe, it, expect } from 'vitest';
import { FileDto } from '@cms-core';
import { plugin } from './index';
import { BOARDS_PREFIX } from './boardRoute';
import { BOARD_TAB_ID } from './constants';

const file = (path: string, isDirectory = false): FileDto => ({ path, isDirectory, size: 0, lastModified: 0 });

describe('hybridflow-ui plugin', () => {
    // A board is a row in a database and has no path, so this plugin claims a **URL prefix** instead
    // of a file type — which is what makes `/boards/major` an address you can send somebody.
    it('claims the boards prefix, with no entry in the `...` menu', () => {
        expect(plugin.appRoutes).toHaveLength(1);
        const [page] = plugin.appRoutes ?? [];
        expect(page.prefix).toBe(BOARDS_PREFIX);
        expect(page.panel).toBe(BOARD_TAB_ID);
        // The way in is the Boards panel tab: the page stays reachable by its URL, but the
        // `...` menu carries no entry for it.
        expect(page.menu).toBeUndefined();
    });

    // A board is a row in a database and has no path, so no file in the tree opens one: every
    // file opens in its own viewer, and the boards open at their URL.
    it('claims no file type at all', () => {
        expect(plugin.fileConfigFor(file('backlog/notes.json'))).toBeNull();
        expect(plugin.fileConfigFor(file('notes/readme.md'))).toBeNull();
        expect(plugin.fileExtensions).toBeUndefined();
    });

    it('keeps its tool bar tabs, boards included', () => {
        expect((plugin.toolBars ?? []).map(tab => tab.title))
            .toEqual(['Board', 'Node', 'Workflow', 'Chain runs', 'Node agents', 'Runners', 'Boards']);
    });

    it('offers a movable board panel in the central area by default', () => {
        const board = plugin.toolBars?.find(tab => tab.id === BOARD_TAB_ID);
        expect(board?.defaultBar).toBe('center');
        expect(board?.pinned).toBeFalsy();
        expect(board?.additionalPanels).toBeDefined();
    });
});
