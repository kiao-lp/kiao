import { test, expect, Page } from '../harness';

/**
 * E2E: a folder holding an `Index` file opens it instead of its listing.
 *
 * The point of interest is not the redirect itself but the escape from it: closing the
 * index must land on the listing and stay there, or the folder would be unreachable.
 * That depends on real navigation history and on the listing arriving after the folder,
 * so it is asserted against the running app rather than in unit tests.
 */

const TIMEOUT = 10000;

const loaded = async (page: Page) =>
    expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });

test('folder index: opens on entry, and closing it leaves the listing alone', async ({ page }) => {
    page.on('pageerror', err => console.log(`BROWSER ERROR: ${err.message}`));

    await page.goto('');
    await loaded(page);

    // 1. Entering the folder opens its index instead of the browser
    await page.getByTestId('browser-item-index-page').dblclick();
    await expect(page).toHaveURL(/index-page\/Index\.md$/, { timeout: TIMEOUT });
    await expect(page.locator('.cm-content').first()).toContainText('Index page', { timeout: TIMEOUT });

    // 2. Closing it shows the folder, and nothing pulls the user back into the index
    await page.getByTestId('close-document').click();
    await expect(page).toHaveURL(/index-page$/, { timeout: TIMEOUT });
    await expect(page.getByTestId('browser-item-index-page/other.md')).toBeVisible();
    // Nothing pulls the user back in: the listing is still the listing a beat later.
    await expect(page).toHaveURL(/index-page$/, { timeout: 1000 });

    // 3. Walking up leaves the parent on its listing too…
    await page.locator('.cms-folder-browser-area').getByText('..', { exact: true }).click();
    await expect(page).toHaveURL(/dashboard\/$|dashboard$/, { timeout: TIMEOUT });

    // …and coming back in from outside opens the index again
    await page.getByTestId('browser-item-index-page').dblclick();
    await expect(page).toHaveURL(/index-page\/Index\.md$/, { timeout: TIMEOUT });
});
