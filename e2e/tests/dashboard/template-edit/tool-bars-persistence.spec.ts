import { test, expect, flushViewState } from '../../harness';

const SELECTORS = {
    STATUS_BAR: '.cms-top-banner',
    RIGHT_TOGGLE: '[data-testid="bar-toggle-right"]',
    RIGHT_COLUMN: '[data-testid="tool-bar-side-right"]',
};


test('tool bars persistence: the right column is remembered across reloads', async ({ page }) => {
    // 1. Navigate to a template (this ensures a plugin with a main view is active)
    await page.goto('templates/Prompt.temp.md');

    // Wait for app load
    // status bar is a reliable indicator that the app is interactive
    await expect(page.locator(SELECTORS.STATUS_BAR)).toBeVisible({ timeout: 15000 });

    // A column that is off is not drawn at all, so its presence *is* its state.
    const column = page.locator(SELECTORS.RIGHT_COLUMN);
    const toggle = page.locator(SELECTORS.RIGHT_TOGGLE);

    // 2. Start with it off. Since the state moved out of localStorage and into the
    // shared view-state file, it arrives however the previous spec left it — the
    // default only holds on a pristine store, so switch it off rather than assume.
    if (await column.count() > 0) {
        await toggle.click();
    }
    await expect(column).toHaveCount(0);
    await flushViewState(page);

    // 3. Switch it on
    await toggle.click();
    await expect(column).toBeVisible();
    await flushViewState(page);

    // 4. Reload Page
    await page.reload();
    await expect(page.locator(SELECTORS.STATUS_BAR)).toBeVisible({ timeout: 15000 });

    // 5. Verify Persistence: still on
    await expect(column).toBeVisible({ timeout: 15000 });

    // 6. Switch it off again
    await toggle.click();
    await expect(column).toHaveCount(0);
    await flushViewState(page);

    // 7. Reload Page
    await page.reload();
    await expect(page.locator(SELECTORS.STATUS_BAR)).toBeVisible({ timeout: 15000 });

    // 8. Verify Persistence: still off
    await expect(column).toHaveCount(0);
});
