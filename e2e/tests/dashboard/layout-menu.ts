import { expect, Page } from '../harness';

/** Keyboard navigation keeps submenu opening independent of popup motion. */
export const openShowSubmenu = async (page: Page, title: string) => {
    await page.locator('.cms-top-banner .anticon-more').click();
    for (const label of ['Show', title]) {
        const item = page.getByRole('menuitem').filter({ has: page.getByText(label, { exact: true }) });
        await expect(item).toBeVisible();
        await item.press('ArrowRight');
    }
};
