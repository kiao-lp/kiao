import { test, expect, Page, workerApi, flushViewState, resetViewState, showMarkdownEditor } from '../harness';
import { openShowSubmenu } from './layout-menu';

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
    await expect(page.locator('[data-split-part="preview"]')).toBeVisible({ timeout: TIMEOUT });
};

const previewToggle = (page: Page) =>
    page.locator('button:has(.anticon-eye), button:has(.anticon-eye-invisible)').last();

test.describe('view state', () => {
    test.beforeEach(resetViewState);
    test.afterEach(resetViewState);

    for (const width of [1280, 600]) {
        test(`opens Markdown in preview only at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            await open(page, FILE);

            await expect(page.locator('[data-split-part="source"]')).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Hide Preview' })).toBeDisabled();
            await expect(page.getByRole('button', { name: 'Show Editor' })).toBeEnabled();
        });
    }

    test('keeps at least one pane visible while switching between preview and editor', async ({ page }) => {
        await open(page, FILE);
        await showMarkdownEditor(page);
        await expect(page.getByRole('button', { name: 'Hide Editor' })).toBeEnabled();
        await expect(page.getByRole('button', { name: 'Hide Preview' })).toBeEnabled();

        await page.getByRole('button', { name: 'Hide Preview' }).click();
        await expect(page.locator('[data-split-part="preview"]')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Hide Editor' })).toBeDisabled();

        await page.getByRole('button', { name: 'Show Preview' }).click();
        await page.getByRole('button', { name: 'Hide Editor' }).click();
        await expect(page.locator('[data-split-part="source"]')).toHaveCount(0);
        await expect(page.locator('[data-split-part="preview"]')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Hide Preview' })).toBeDisabled();
    });

    test('shows the preview when saved settings hide both panes', async ({ page }) => {
        const response = await fetch(`${workerApi()}/config/${STATE_DOC}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                version: 1, global: {}, folders: {},
                files: { [FILE]: { markdown: { showSource: false, showPreview: false } } },
            }),
        });
        expect(response.ok).toBeTruthy();
        await open(page, FILE);

        await expect(page.locator('[data-split-part="source"]')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Hide Preview' })).toBeDisabled();
        await showMarkdownEditor(page);
        await expect(page.getByRole('button', { name: 'Hide Preview' })).toBeEnabled();
    });

    test('reopens a document with the panes it was left with', async ({ page }) => {
        await open(page, FILE);
        await showMarkdownEditor(page);
        const paneCount = () => page.locator('.cm-editor').count();
        await previewToggle(page).click();
        await flushViewState(page);
        const panes = await paneCount();

        await page.reload();
        await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: TIMEOUT });

        await expect.poll(paneCount, { timeout: TIMEOUT }).toBe(panes);
        await expect(page.locator('[data-split-part="preview"]')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Hide Editor' })).toBeDisabled();
        const stored = (await readState())?.files?.[FILE]?.markdown;
        expect(stored).toMatchObject({ showSource: true, showPreview: false });
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
        await showMarkdownEditor(page);
        await flushViewState(page);

        const keys = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
        expect(keys.filter(k =>
            /theme|toolBars|fileBrowser|voice-language|mlscript-layout|zoom|activeTab/i.test(k)))
            .toEqual([]);
    });

    test('keeps toolbar placement across files; document URLs select Document and File tree', async ({ page }) => {
        await open(page, FILE);
        await page.getByTestId('bar-toggle-left').click();
        await expect(page.getByTestId('tool-bar-left').getByTestId('nav-tree')).toBeVisible();
        await expect(page.getByTestId('tool-bar-center').getByRole('tab', { name: 'Document', exact: true }))
            .toHaveAttribute('aria-selected', 'true');

        await openShowSubmenu(page, 'File tree');
        await page.getByTestId('layout-cell-file-navigation-tree-center').click();
        await page.keyboard.press('Escape');
        await page.mouse.move(0, 0);

        const treeTab = page.getByTestId('tool-bar-center').getByRole('tab', { name: 'File tree', exact: true });
        const documentTab = page.getByTestId('tool-bar-center').getByRole('tab', { name: 'Document', exact: true });

        for (const path of ['smoke/roundtrip.md', 'smoke/sample.txt', FILE]) {
            await treeTab.click();
            await page.getByTestId(`nav-item-${path}`).click();
            await expect(page).toHaveURL(new RegExp(`${path.replace('.', '\\.')}$`));
            await expect(documentTab).toHaveAttribute('aria-selected', 'true');
            const content = path.endsWith('.md') ? '.configured-markdown-container' : '.cm-content';
            await expect(page.getByTestId('tool-bar-center').locator(content).first()).toBeVisible();
        }
        await treeTab.click();
        await flushViewState(page);
        await page.reload();

        await expect(documentTab).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByTestId('tool-bar-center').locator('.configured-markdown-container')).toBeVisible();
        const saved = await readState();
        expect(saved?.global.toolBars).toMatchObject({
            placement: { 'file-navigation-tree': 'center' },
        });
        for (const entry of Object.values(saved?.files ?? {})) expect(entry.toolBars).toBeUndefined();
    });

    test('does not persist document scroll positions', async ({ page }) => {
        await open(page, FILE);
        await flushViewState(page);
        const saved = await readState();
        const writes: string[] = [];
        page.on('request', request => {
            if (request.method() === 'PUT' && request.url().includes(STATE_DOC)) writes.push(request.url());
        });

        const preview = page.locator('[data-split-part="preview"]');
        await preview.evaluate(element => { element.scrollTop = 500; });
        await expect.poll(() => preview.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        await flushViewState(page);

        expect(writes).toEqual([]);
        expect(await readState()).toEqual(saved);
        await page.reload();
        await expect(preview).toBeVisible({ timeout: TIMEOUT });
        await expect.poll(() => preview.evaluate(element => element.scrollTop)).toBe(0);
    });
});
