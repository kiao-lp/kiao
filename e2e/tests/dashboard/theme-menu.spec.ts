import { test, expect, Page, resetViewState, flushViewState } from '../harness';

/**
 * E2E: choosing a theme from the banner's tools menu.
 *
 * The charter ships four themes and the control used to be a light/dark toggle, which could
 * only ever reach two of them. What replaced it is a menu, and what a menu has to do is put the
 * chosen name on `<html data-theme>` — because that attribute is the whole mechanism: the
 * stylesheets key off it, and everything drawn from a CSS variable follows without being told.
 *
 * Asserted against the real app rather than the component: the value has to survive the round
 * trip through the config document the choice is stored in, and a stylesheet that never made it
 * into the bundle would leave the attribute right and the screen unchanged — which is why the
 * page's own background is read back rather than trusted.
 */

const TIMEOUT = 15000;

/** Each menu opens on a motion of its own, and nothing is aimed at until it has stopped moving. */
const SETTLE_MS = 300;

const open = async (page: Page) => {
    await page.goto('');
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
};

/**
 * Opens the tools menu on its theme submenu.
 *
 * Everything is scoped to what is on screen: choosing a theme re-renders the application under
 * the menu, and antd leaves the popup it was closing in the DOM for the length of its fade. An
 * unscoped locator finds that one, waits for it to become clickable, and never gets it.
 *
 * Visible is not yet still, so each step is given the motion that brings it before the next one is
 * aimed at it — the pattern the other menu-walking specs use.
 */
const openThemeMenu = async (page: Page) => {
    // Start from a closed menu: opening a second one while the first is still fading finds the
    // one on its way out.
    await expect(page.locator('.ant-dropdown:visible')).toHaveCount(0, { timeout: TIMEOUT });
    await page.locator('.cms-top-banner .anticon-more').click();
    const theme = page.locator('.ant-dropdown-menu:visible').first()
        .locator('.ant-dropdown-menu-submenu-title').getByText('Theme', { exact: true });
    await expect(theme).toBeVisible({ timeout: TIMEOUT });
    await page.waitForTimeout(SETTLE_MS);
    await theme.hover();
    const popup = page.locator('.ant-dropdown-menu-submenu-popup:visible');
    await expect(popup).toBeVisible({ timeout: TIMEOUT });
    await page.waitForTimeout(SETTLE_MS);
    return popup;
};

/**
 * Picks a theme by its label, retrying the whole opening rather than failing on it.
 *
 * A submenu aimed at while it is still arriving is one the click misses — the point under it is
 * still the page behind — and the pointer then sits off the title holding it open, so it closes
 * and the item never comes back. Choosing a theme re-renders the application, which is exactly
 * when the next opening is slowest, so this is the ordinary case here rather than a rare one. The
 * click is bounded so a lost submenu costs one wait instead of the test's whole budget.
 */
const chooseTheme = async (page: Page, label: string) => {
    for (let attempt = 1; ; attempt += 1) {
        await page.keyboard.press('Escape');
        const popup = await openThemeMenu(page);
        try {
            await popup.getByText(label, { exact: true }).click({ timeout: TIMEOUT });
            return;
        } catch (err) {
            expect(attempt, `the tools menu never opened on ${label}: ${err}`).toBeLessThan(3);
        }
    }
};

const currentTheme = (page: Page) =>
    page.evaluate(() => document.documentElement.getAttribute('data-theme'));

/** What the page is actually painted with, as the browser resolves it. */
const backgroundColor = (page: Page) =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe('theme menu', () => {
    test.afterEach(resetViewState);

    test('offers every theme the charter ships, and dresses the page in the one chosen', async ({ page }) => {
        await open(page);
        expect(await currentTheme(page)).toBe('dark');
        const asDark = await backgroundColor(page);

        // Every theme, in the charter's order, and the one in use marked as such.
        const popup = await openThemeMenu(page);
        await expect(popup.locator('.ant-dropdown-menu-title-content'))
            .toHaveText(['Dark', 'Light', 'Sober dark', 'Sober light'], { timeout: TIMEOUT });
        await expect(popup.locator('.ant-dropdown-menu-item-selected')).toHaveText('🌙Dark');

        await chooseTheme(page, 'Sober light');
        await expect.poll(() => currentTheme(page), { timeout: TIMEOUT }).toBe('sober-light');
        // kiao-sober-light.css reached the bundle: the page is light, and not the dark it was.
        const asSoberLight = await backgroundColor(page);
        expect(asSoberLight).not.toBe(asDark);
        expect(asSoberLight).toBe('rgb(248, 250, 252)');

        await chooseTheme(page, 'Sober dark');
        await expect.poll(() => currentTheme(page), { timeout: TIMEOUT }).toBe('sober-dark');
        expect(await backgroundColor(page)).toBe('rgb(13, 17, 23)');

        // The mark follows the choice: the menu reads the theme rather than remembering
        // whatever was last clicked in it.
        await expect((await openThemeMenu(page)).locator('.ant-dropdown-menu-item-selected'))
            .toHaveText('🌙Sober dark');
    });

    test('keeps the chosen theme across a full page load', async ({ page }) => {
        await open(page);
        await chooseTheme(page, 'Sober dark');
        await expect.poll(() => currentTheme(page), { timeout: TIMEOUT }).toBe('sober-dark');
        await flushViewState(page);

        await page.reload();
        await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });

        // index.html carries `dark` until the stored choice arrives, so this is a poll.
        await expect.poll(() => currentTheme(page), { timeout: TIMEOUT }).toBe('sober-dark');
        expect(await backgroundColor(page)).toBe('rgb(13, 17, 23)');
    });
});
