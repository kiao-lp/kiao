import { test, expect, Page, workerApi, flushViewState } from '../../harness';

/**
 * E2E: a mindmap shown *beside* a markdown document — the side-document mechanism
 * (`cms-core/side-documents/`) with its first two participants.
 *
 * The promise is a third switch next to "Hide Editor" and "Hide Preview": pressing it draws a map
 * to the right of the preview, creating `<the markdown file>.mmap.json` the first time, and the
 * map is still there the next time the document is opened. Asserted against the real app because
 * the whole point is that two plugins which never import one another end up in one row: the wiring
 * is App.tsx's plugin registry, which no unit test mounts.
 */

const TIMEOUT = 15000;
const FILE = 'folder-a/note.md';
const SIDE_FILE = 'folder-a/note.md.mmap.json';

const mindmapToggle = (page: Page) => page.getByRole('button', { name: /(Show|Hide) Mindmap/ });
const mindmapPane = (page: Page) => page.locator('[data-side-document="mindmap"]');

const sideFile = async (): Promise<any | null> => {
    const response = await fetch(`${workerApi()}/getFile?path=${encodeURIComponent(SIDE_FILE)}`);
    return response.ok ? response.json() : null;
};

const open = async (page: Page) => {
    await page.goto(FILE);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: TIMEOUT });
};

test.describe('a mindmap beside a markdown document', () => {
    // Every test starts from the same document: no map drawn, and none in the store. The pane is
    // put away before the file goes, so nothing is left pointing at a document that is not there.
    test.beforeEach(async ({ page }) => {
        await open(page);
        const toggle = mindmapToggle(page);
        if ((await toggle.getAttribute('aria-label')) === 'Hide Mindmap') {
            await toggle.click();
            await expect(mindmapPane(page)).toHaveCount(0);
            await flushViewState(page);
        }
        await fetch(`${workerApi()}/delete?path=${encodeURIComponent(SIDE_FILE)}`, { method: 'DELETE' })
            .catch(() => undefined);
    });

    test('draws the map beside the document, creating it the first time', async ({ page }) => {
        // Nothing until it is asked for: a document carries no map it never wanted.
        expect(await sideFile()).toBeNull();
        await expect(mindmapPane(page)).toHaveCount(0);

        await mindmapToggle(page).click();

        // Source, preview and map, left to right — the editor is still there.
        await expect(mindmapPane(page).locator('.mindmap')).toBeVisible({ timeout: TIMEOUT });
        await expect(page.locator('.cm-content').first()).toBeVisible();
        await expect(page.locator('.configured-markdown-container').first()).toBeVisible();

        // The map is a document of the store, named after the one it belongs to.
        await expect.poll(async () => (await sideFile())?.docType ?? null, { timeout: TIMEOUT })
            .toBe('QuickMindmap');
    });

    test('is still there the next time the document is opened', async ({ page }) => {
        await mindmapToggle(page).click();
        await expect(mindmapPane(page).locator('.mindmap')).toBeVisible({ timeout: TIMEOUT });
        await flushViewState(page);

        await page.reload();
        await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
        await expect(mindmapPane(page).locator('.mindmap')).toBeVisible({ timeout: TIMEOUT });
    });

    test('takes the map back down without touching its file', async ({ page }) => {
        await mindmapToggle(page).click();
        await expect(mindmapPane(page).locator('.mindmap')).toBeVisible({ timeout: TIMEOUT });
        await expect.poll(async () => await sideFile(), { timeout: TIMEOUT }).not.toBeNull();

        await mindmapToggle(page).click();
        await expect(mindmapPane(page)).toHaveCount(0);
        await expect(page.locator('.cm-content').first()).toBeVisible();
        expect(await sideFile()).not.toBeNull();
    });

    test('offers no map of its own to a mindmap document', async ({ page }) => {
        await page.goto('folder-a/Mindmap.mmap.json');
        await expect(page.locator('.mindmap')).toBeVisible({ timeout: TIMEOUT });
        await expect(mindmapToggle(page)).toHaveCount(0);
    });
});
