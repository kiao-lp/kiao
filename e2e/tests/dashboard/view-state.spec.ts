import { test, expect, Page, workerApi, flushViewState } from '../harness';

/**
 * E2E: the view state Dashboard keeps in the `dashboard-view-state.json` config document.
 *
 * The promise is that a file reopens as it was left — the same panes — after a
 * navigation and after a full page load. The full page load is the point: it is
 * what the OIDC redirect does when a token renewal fails, and the reason the
 * state lives on the server rather than in component state.
 */

const TIMEOUT = 15000;
const FILE = 'smoke/scroll-sync.md';
const STATE_DOC = 'dashboard-view-state.json';

interface ViewStateFile {
    version: number;
    global: Record<string, any>;
    folders: Record<string, any>;
    files: Record<string, any>;
}

const readState = async (): Promise<ViewStateFile | null> => {
    const response = await fetch(`${workerApi()}/config/${STATE_DOC}`);
    return response.ok ? response.json() as Promise<ViewStateFile> : null;
};

const open = async (page: Page, path: string) => {
    await page.goto(path);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: TIMEOUT });
};

const previewToggle = (page: Page) =>
    page.locator('button:has(.anticon-eye), button:has(.anticon-eye-invisible)').last();

test.describe('view state', () => {
    test('reopens a document with the panes it was left with', async ({ page }) => {
        await open(page, FILE);
        const paneCount = () => page.locator('.cm-editor').count();
        await previewToggle(page).click();
        await flushViewState(page);
        const panes = await paneCount();

        await page.reload();
        await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: TIMEOUT });

        await expect.poll(paneCount, { timeout: TIMEOUT }).toBe(panes);
        const stored = (await readState())?.files?.[FILE]?.markdown;
        expect(stored).toMatchObject({ showPreview: false });
    });

    // The file is git-tracked, so an entry per file merely *opened* would be noise.
    test('writes nothing for a file that was only opened', async ({ page }) => {
        await open(page, 'smoke/roundtrip.md');
        await flushViewState(page);

        expect((await readState())?.files?.['smoke/roundtrip.md']).toBeUndefined();
    });

    // View state lives only here, never in browser storage; a copy there would let the two disagree.
    test('keeps no view state in browser storage', async ({ page }) => {
        await open(page, FILE);
        await previewToggle(page).click();
        await flushViewState(page);

        const keys = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
        expect(keys.filter(k =>
            /theme|toolBars|fileBrowser|voice-language|mlscript-layout|zoom|activeTab/i.test(k)))
            .toEqual([]);
    });
});
