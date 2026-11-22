import { test, expect, Page, showMarkdownEditor } from '../harness';

/**
 * E2E: the markdown document's table of contents.
 *
 * The menu is an overview of the headings, and picking one has to reach the section in whatever
 * panes are open: the rendered block in the preview, the heading's line in the source. Both are
 * scroll geometry, so they are asserted in a browser. `smoke/scroll-sync.md` labels every line,
 * so which section is at the top of a pane has an answer that does not come from the code under
 * test.
 */

const TIMEOUT = 15000;
const FILE = 'smoke/scroll-sync.md';

const open = async (page: Page) => {
    await page.goto(FILE);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.configured-markdown-container')).toBeVisible({ timeout: TIMEOUT });

    // The preview's scroll container, resolved by behaviour rather than by walking a fixed
    // number of parents — the box carrying the zoom is one of them, and it is not the one that
    // scrolls.
    await page.evaluate(() => {
        (window as any).__preview = () => {
            let element = document.querySelector('.configured-markdown-container') as HTMLElement | null;
            while (element) {
                if (getComputedStyle(element).overflowY === 'auto') return element;
                element = element.parentElement;
            }
            throw new Error('no scrollable preview container');
        };
    });
    await page.evaluate(() => { (window as any).__preview().scrollTop = 0; });
};

const pick = async (page: Page, label: string) => {
    await page.getByRole('button', { name: 'Table of Contents' }).click();
    await page.getByRole('menuitem', { name: label }).click();
};

/** How far the heading's rendered block sits from the top of the preview pane. */
const headingOffset = (page: Page, line: number): Promise<number> => page.evaluate((sourceLine) => {
    const preview = (window as any).__preview() as HTMLElement;
    const heading = preview.querySelector(`[data-source-line="${sourceLine}"]`)!;
    return heading.getBoundingClientRect().top - preview.getBoundingClientRect().top;
}, line);

test.describe('the markdown table of contents', () => {
    test('lists the document headings in order', async ({ page }) => {
        await open(page);

        await page.getByRole('button', { name: 'Table of Contents' }).click();

        const items = page.getByRole('menuitem');
        await expect(items).toHaveCount(41);
        await expect(items.first()).toHaveText('Scroll sync probe line=1');
        await expect(items.nth(1)).toHaveText('Section 1 line=3');
        await expect(items.last()).toHaveText('Section 40 line=293');
    });

    test('brings the picked section to the top of the preview', async ({ page }) => {
        await open(page);
        expect(await headingOffset(page, 221)).toBeGreaterThan(200);

        await pick(page, 'Section 30 line=221');

        // `block: 'start'` puts the heading at the top of the pane, not merely in view.
        await expect.poll(() => headingOffset(page, 221), { timeout: TIMEOUT }).toBeLessThan(40);
        expect(await headingOffset(page, 221)).toBeGreaterThan(-1);
    });

    test('puts the caret on the heading line in the source pane', async ({ page }) => {
        await open(page);
        await showMarkdownEditor(page);

        await pick(page, 'Section 30 line=221');

        await expect(page.locator('.cm-activeLine').first()).toContainText('Section 30 line=221', { timeout: TIMEOUT });
    });
});
