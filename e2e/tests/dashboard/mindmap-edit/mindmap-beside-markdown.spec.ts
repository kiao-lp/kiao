import { test, expect, Page, workerApi, flushViewState } from '../../harness';

/**
 * E2E: a mindmap opened from a markdown document as the secondary document.
 *
 * The switch next to "Hide Editor" and "Hide Preview" opens
 * `<the markdown file>.mmap.json` in the secondary document panel, creating it
 * the first time. The markdown editor stays in the primary panel.
 */

const TIMEOUT = 15000;
const FILE = 'folder-a/note.md';
const SIDE_FILE = 'folder-a/note.md.mmap.json';

const mindmapToggle = (page: Page) => page.getByRole('button', { name: /(Show|Hide) Mindmap/ });
const secondaryPanel = (page: Page) => page.locator('[data-testid="secondary-document-panel"]');
const mindmapPane = (page: Page) => secondaryPanel(page).locator('.mindmap');

const sideFile = async (): Promise<any | null> => {
    const response = await fetch(`${workerApi()}/getFile?path=${encodeURIComponent(SIDE_FILE)}`);
    return response.ok ? response.json() : null;
};

const open = async (page: Page) => {
    await page.goto(FILE);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: TIMEOUT });
};

test.describe('a mindmap opened from a markdown document', () => {
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

    test('draws the map in the secondary panel, creating it the first time', async ({ page }) => {
        expect(await sideFile()).toBeNull();
        await expect(mindmapPane(page)).toHaveCount(0);

        await mindmapToggle(page).click();

        await expect(mindmapPane(page)).toBeVisible({ timeout: TIMEOUT });
        await expect(page.locator('.cm-content').first()).toBeVisible();
        await expect(page.locator('.configured-markdown-container').first()).toBeVisible();

        await expect.poll(async () => (await sideFile())?.docType ?? null, { timeout: TIMEOUT })
            .toBe('QuickMindmap');
    });

    test('closes from the secondary panel and opens again from the toggle', async ({ page }) => {
        await mindmapToggle(page).click();
        await expect(mindmapPane(page)).toBeVisible({ timeout: TIMEOUT });

        await page.getByTestId('close-secondary-document').click();
        await expect(mindmapPane(page)).toHaveCount(0);
        await expect(secondaryPanel(page)).toContainText('No secondary document');

        await mindmapToggle(page).click();
        await expect(mindmapPane(page)).toBeVisible({ timeout: TIMEOUT });
    });

    test('takes the map back down without touching its file', async ({ page }) => {
        await mindmapToggle(page).click();
        await expect(mindmapPane(page)).toBeVisible({ timeout: TIMEOUT });
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
