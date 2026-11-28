import { test, expect, Page, MINIMAL_APP } from '../harness';

// A dedicated stack builds Dashboard with only code-edit and text-edit while
// keeping the fixture store's full plugin requirements. The spec checks that a
// mindmap opens in the fallback editor and Configuration lists code-edit,
// omits mindmap-edit, and reports hybridflow as missing.
const TIMEOUT = 20000;

const loaded = async (page: Page) =>
    expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });

test.describe('a minimal assembly', () => {
    test('opens a file no plugin claims with the fallback editor', async ({ page }) => {
        await page.goto(`${MINIMAL_APP}/folder-a/Mindmap.mmap.json`);
        await loaded(page);

        await expect(page.locator('.cm-editor')).toBeVisible({ timeout: TIMEOUT });
        await expect(page.locator('.mindmap-zoom-container')).toHaveCount(0);
        await expect(page).toHaveTitle(/Mindmap/);
    });

    test('says which of the plugins the store asks for this build does not carry', async ({ page }) => {
        await page.goto(`${MINIMAL_APP}/smoke/sample.txt`);
        await loaded(page);

        await page.getByRole('button', { name: 'Tools', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Configuration…' }).click();

        await expect(page.getByTestId('plugin-row-code-edit')).toBeVisible({ timeout: TIMEOUT });
        await expect(page.getByTestId('plugin-row-mindmap-edit')).toHaveCount(0);
        await expect(page.getByText(/was not assembled with/)).toContainText('hybridflow');
    });
});
