import { test, expect, Locator, Page, restoreFixture } from '../../harness';

/**
 * E2E: the lists behind the selectors that set how a note looks.
 *
 * Those selectors draw what they set — a swatch, a line of the weight it means, a shape — and
 * carry no arrow, so each box is only as wide as the one picture in it. A list matched to that
 * box is a column of clipped items: what the choice is made from cannot be seen at all. The list
 * is therefore sized by what is in it, in the bar where the next note's style is set and in the
 * toolbar of the note being edited alike.
 */

const TIMEOUT = 15000;
const FILE = 'folder-a/Mindmap.mmap.json';

const BAR_SELECTORS = [
    'Text size of a new note',
    'Shape of a new note',
    'Border weight of a new note',
    'Border colour of a new note',
    'Background colour of a new note'
];

const NOTE_SELECTORS = [
    'Vertical alignment', 'Horizontal alignment', 'Text size',
    'Border weight', 'Border color', 'Shape', 'Background color', 'Z-index'
];

/**
 * The list that is open.
 *
 * antd does not take a closed list out of the page: it plays a leave animation over it, and for as
 * long as that lasts the list still has a box and still carries every class it had. So the one
 * being read is the one that is neither hidden nor on its way out — anything looser matches two
 * lists at once, which Playwright reports as a strict-mode violation rather than as a wait.
 */
const OPEN_LIST = '.ant-select-dropdown:visible:not([class*="-leave"])';

/**
 * Opens a selector's list and reports, for every option in it, whether the item is drawn whole:
 * antd clips an option that outgrows the list rather than widening the list, so an item asked for
 * more room than it has is exactly what a list matched to a one-swatch box produces.
 */
const listedWhole = async (page: Page, select: Locator): Promise<boolean[]> => {
    // Opened onto a page showing no list, so the one that comes up is the only one there.
    await expect(page.locator(OPEN_LIST)).toHaveCount(0, { timeout: TIMEOUT });
    await select.click();
    const popup = page.locator(OPEN_LIST);
    await expect(popup).toBeVisible({ timeout: TIMEOUT });

    const options = popup.locator('.ant-select-item-option-content');
    await expect.poll(() => options.count(), { timeout: TIMEOUT }).toBeGreaterThan(1);

    const fits = await options.evaluateAll(
        (items) => items.map(item => item.scrollWidth <= item.clientWidth));

    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden({ timeout: TIMEOUT });
    return fits;
};

/**
 * The specs of this map all write it — notes dragged, grouped, resized — and a worker runs them
 * one after another in one store, so each starts from the fixture rather than from whatever the
 * last of them left behind.
 */
test.beforeEach(async ({ request }) => { await restoreFixture(request, FILE); });

test('mindmap: the note-style lists are as wide as what they offer', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto(FILE);
    const mindmap = page.locator('.mindmap');
    // The first navigation of a run waits on the plugins being compiled and loaded, which is
    // longer than anything the test itself waits for.
    await expect(mindmap).toBeVisible({ timeout: 4 * TIMEOUT });

    // The bar: the style the next note will be made with.
    for (const title of BAR_SELECTORS) {
        const select = page.locator(`.mindmap-panel .ant-select[title="${title}"]`);
        expect(await listedWhole(page, select), title).not.toContain(false);
    }

    // The note's own toolbar, which offers the same pictures over the note being edited.
    await mindmap.click({ position: { x: 20, y: 20 } }); // leave VISUALIZE mode
    await page.locator('.mindmap-rect').filter({ hasText: 'Note A' }).click();
    const toolbar = page.locator('.mindmap-note-edit-toolbar');
    await expect(toolbar).toBeVisible({ timeout: TIMEOUT });

    for (const title of NOTE_SELECTORS) {
        expect(await listedWhole(page, toolbar.locator(`.ant-select[title="${title}"]`)), title)
            .not.toContain(false);
    }

    expect(pageErrors).toEqual([]);
});
