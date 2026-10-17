import { describe, it, expect } from 'vitest';
import { FileDto } from '@cms-core';
import { plugin } from './index';
import { BOARDS_PREFIX } from './boardRoute';

const file = (path: string, isDirectory = false): FileDto => ({ path, isDirectory, size: 0, lastModified: 0 });

describe('hybridflow-ui plugin', () => {
    // A board is a row in a database and has no path, so this plugin claims a **URL prefix** instead
    // of a file type — which is what makes `/boards/major` an address you can send somebody.
    it('claims the boards prefix, with no entry in the `...` menu', () => {
        expect(plugin.appRoutes).toHaveLength(1);
        const [page] = plugin.appRoutes ?? [];
        expect(page.prefix).toBe(BOARDS_PREFIX);
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

    // The flow node panel, the chain runs panel and the agents panel stay: the first two are about
    // the open board and the runs playing, and the third is what the flow nodes pick to be played on —
    // none of which became a file question. The workflow panel joins them beside the Node tab —
    // the name of the open rectangle — the runners list as the next lateral tab — what the tasks
    // pick to be played *where* — and the boards list as the last.
    it('keeps its tool bar tabs, boards included', () => {
        expect((plugin.toolBars ?? []).map(tab => tab.title))
            .toEqual(['Node', 'Workflow', 'Chain runs', 'Node agents', 'Runners', 'Boards']);
    });
});
