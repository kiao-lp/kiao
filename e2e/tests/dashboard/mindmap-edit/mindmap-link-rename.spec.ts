import { test, expect, APIRequestContext, workerApi, restoreFixture } from '../../harness';

/**
 * E2E: a link in a note follows the document it points at.
 *
 * Renaming a document makes worker rewrite every reference to it across the store, the
 * notes of a map included. A map on screen while that happens used to show — and then write back —
 * the link as it was: the repair landed on the file, and the next note moved put the dead link
 * over it. So the assertion is that the note follows the rename **without a reload**, which is
 * what the map being read from the file while it is open buys.
 *
 * The rename goes through worker, which is exactly the call the file browser makes.
 */

const TIMEOUT = 15000;
const MAP = 'smoke/link-rename.mmap.json';
const FOLDER = 'smoke/💼';
const BEFORE = `${FOLDER}/Orientation.md`;
const AFTER = `${FOLDER}/Strategy.md`;

/** What the note's link is written as: the form the address bar gives, and the store keeps. */
const stored = (path: string) => `/${path.split('/').map(encodeURIComponent).join('/')}`;

const api = (route: string, query: Record<string, string>) =>
    `${workerApi()}${route}?${new URLSearchParams(query)}`;

test.beforeEach(async ({ request }) => {
    // The rename this spec performs is what the previous run left behind: take it back out before
    // the fixtures land, so the delete's own link fix cannot reach the map they restore.
    await request.fetch(api('/delete', { path: AFTER }), { method: 'DELETE' });
    await restoreFixture(request, BEFORE);
    await restoreFixture(request, MAP);
});

const rename = async (request: APIRequestContext, from: string, to: string) => {
    const response = await request.fetch(api('/rename', { path: from, newPath: to }), { method: 'POST' });
    expect(response.ok(), `renaming ${from}`).toBeTruthy();
};

test('a note follows the document its link names when that document is renamed', async ({ page, request }) => {
    await page.goto(MAP);
    await expect(page.locator('.mindmap')).toBeVisible({ timeout: TIMEOUT });

    const link = page.locator('.mindmap-text-rich-text a');
    const destination = async () => (await link.getAttribute('href')) ?? '';
    await expect.poll(destination, { timeout: TIMEOUT }).toContain(stored(BEFORE));

    await rename(request, BEFORE, AFTER);

    // No reload anywhere in this test: the map is read again because the file moved under it.
    await expect.poll(destination, { timeout: TIMEOUT }).toContain(stored(AFTER));

    // And what is on screen is what the file holds — the open map is not a copy waiting to be
    // written back over the repair.
    const written = await request.fetch(api('/getFile', { path: MAP }));
    expect(await written.text()).toContain(stored(AFTER));
});
