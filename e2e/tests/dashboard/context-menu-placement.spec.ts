import { test, expect, Locator, Page } from '../harness';

// Generous like the other specs' first-load waits: on a cold shard under a full run, vite is
// still compiling the application the banner belongs to.
const TIMEOUT = 20000;

/**
 * E2E Test: context menus stay inside the viewport.
 *
 * A file context menu that did not fit below the pointer used to be laid out above it and
 * left there even when it then ran off the top of the window — losing its first items, with
 * no way to reach them. A short viewport, which a browser zoomed to 150% gives, makes it
 * easy to hit: right-click a file halfway down the page. A menu that fits in the viewport
 * must be shown whole wherever it is opened from.
 *
 * The two views build that menu differently — the details table drives one Ant Design
 * Dropdown from the pointer position, the grid gives every tile its own — so both are
 * covered here.
 */

/** Short enough that the file context menu cannot fit below a pointer halfway down. */
const VIEWPORT = { width: 1100, height: 560 };

const openMenuAt = async (page: Page, x: number, y: number): Promise<Locator> => {
    await page.mouse.click(x, y, { button: 'right' });
    const menu = page.locator('.ant-dropdown:not(.ant-dropdown-hidden)').first();
    await expect(menu).toBeVisible({ timeout: TIMEOUT });
    await page.waitForTimeout(300); // let the alignment settle before measuring
    return menu;
};

const expectWhollyVisible = async (page: Page, menu: Locator, opened: string) => {
    const box = (await menu.boundingBox())!;
    const { width, height } = page.viewportSize()!;
    // A menu taller than the window has to overflow — such a case would prove nothing.
    expect(box.height, `menu opened ${opened} is taller than the viewport`).toBeLessThanOrEqual(height);
    expect(box.y, `menu opened ${opened} runs off the top`).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `menu opened ${opened} runs off the bottom`).toBeLessThanOrEqual(height);
    expect(box.x, `menu opened ${opened} runs off the left`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `menu opened ${opened} runs off the right`).toBeLessThanOrEqual(width);
};

const closeMenu = async (page: Page) => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
};

/** Opens a folder holding enough files to fill a short viewport. */
const openFolder = async (page: Page) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto('smoke');
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await page.waitForTimeout(500);
};

test('a file context menu stays inside the viewport wherever it is opened', async ({ page }) => {
    await openFolder(page);
    const rows = page.locator('.cms-folder-row');
    await expect(rows.first()).toBeVisible({ timeout: TIMEOUT });
    const column = (await rows.first().boundingBox())!.x + 60;
    const { height, width } = VIEWPORT;

    // Down the page: near the bottom the menu is laid out upwards and fits, while from
    // halfway down it is laid out upwards too — and used to run off the top.
    for (const y of [height - 10, height - 60, Math.round(height * 0.75), Math.round(height * 0.55)]) {
        const menu = await openMenuAt(page, column, y);
        await expectWhollyVisible(page, menu, `at y=${y}`);
        await closeMenu(page);
    }

    // Against the right edge, where it is laid out leftwards.
    const menu = await openMenuAt(page, width - 20, Math.round(height * 0.75));
    await expectWhollyVisible(page, menu, 'against the right edge');
});

test('a grid tile context menu stays inside the viewport', async ({ page }) => {
    await openFolder(page);
    await page.locator('.cms-view-mode-grid').click();
    await page.waitForTimeout(500);
    const tiles = page.locator('.cms-file-tile');
    await expect(tiles.first()).toBeVisible({ timeout: TIMEOUT });

    // The lowest tile still wholly in view.
    let tile: { x: number; y: number; width: number; height: number } | null = null;
    for (let i = (await tiles.count()) - 1; i >= 0 && !tile; i--) {
        const box = await tiles.nth(i).boundingBox();
        if (box && box.width > 0 && box.y + box.height <= VIEWPORT.height) tile = box;
    }
    expect(tile, 'no grid tile wholly in view to open a menu on').not.toBeNull();

    const menu = await openMenuAt(page, tile!.x + 20, tile!.y + tile!.height / 2);
    await expectWhollyVisible(page, menu, 'on a grid tile');
});
