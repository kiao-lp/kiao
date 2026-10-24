import { test, expect, Page, resetViewState, awaitWrite, modifiedAt, restoreFixture } from '../../harness';

/**
 * E2E: the ten colours a note is drawn in — the fill behind its text, and the ink of its border.
 *
 * Both are chosen once for the map, in the top bar, as the style of a new relation is: notes come
 * in series, and a run of them in one colour is what the choice is for. The two families are the
 * same ten names read two ways — a quiet fill to be read over, an ink to be seen on the canvas —
 * and every rule that draws one is built from the name, so the spec first asks the running theme
 * whether it defines all twenty: a name with no variable behind it draws nothing and says nothing.
 *
 * It then asks the three selectors what shape they offer the palette in. Eleven swatches in a
 * column are taller than the list opens, which puts half the colours behind a scroll; laid out as
 * a rectangle they are all in sight, and that is what the spec holds them to.
 */

const TIMEOUT = 15000;
const FILE = 'folder-a/Mindmap.mmap.json';

/** The colours the map offers, in the order the model names them (`MINDMAP_COLORS`). */
const COLOURS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'brown', 'grey'];

/**
 * The list that is open. antd leaves a closed list in the page for as long as its leave animation
 * lasts, so the one being read is the one that is neither hidden nor on its way out.
 */
const OPEN_LIST = '.ant-select-dropdown:visible:not([class*="-leave"])';

/** Picks from one of the bar's selectors, each of which is named by what it sets. */
const choose = async (page: Page, selector: string, option: string) => {
    await expect(page.locator(OPEN_LIST)).toHaveCount(0, { timeout: TIMEOUT });
    await page.locator(`.mindmap-panel .ant-select[title="${selector}"]`).click();
    await page.locator(OPEN_LIST)
        .locator(`.ant-select-item-option[title="${option}"]`).click();
};

/** Waits for the popup's swatches to occupy their two rows without scrolling. */
const expectPaletteLayout = async (page: Page, selector: string) => {
    await expect(page.locator(OPEN_LIST)).toHaveCount(0, { timeout: TIMEOUT });
    await page.locator(`.mindmap-panel .ant-select[title="${selector}"]`).click();
    const popup = page.locator(OPEN_LIST);
    await expect(popup).toBeVisible({ timeout: TIMEOUT });

    await expect.poll(() => popup.evaluate((root) => {
        const options = Array.from(root.querySelectorAll('.ant-select-item-option'));
        const boxes = options.map((option) => option.getBoundingClientRect());
        const holder = root.querySelector('.rc-virtual-list-holder') as HTMLElement;
        return {
            options: options.length,
            rows: new Set(boxes.map((box) => Math.round(box.top))).size,
            columns: new Set(boxes.map((box) => Math.round(box.left))).size,
            scrollable: holder.scrollHeight > holder.clientHeight + 1
        };
    }), { message: selector, timeout: TIMEOUT }).toEqual({
        options: 11,
        rows: 2,
        columns: 6,
        scrollable: false
    });

    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden({ timeout: TIMEOUT });
};

/** Where the map starts from, so a write of the editor's own can be waited for by its time. */
let restoredAt = 0;

/** This spec adds a note to the map, and every other spec of it starts from the fixture. */
test.beforeEach(async ({ request }) => {
    await restoreFixture(request, FILE);
    restoredAt = await modifiedAt(request, FILE);
});

/** The style the bar is set to outlives the spec that set it, so this one puts it back. */
test.afterEach(resetViewState);

test('mindmap: a new note is filled and bordered in the colours the top bar is set to', async ({ page, request }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto(FILE);
    const mindmap = page.locator('.mindmap');
    // The first navigation of a run waits on the plugins being compiled and loaded.
    await expect(mindmap).toBeVisible({ timeout: 4 * TIMEOUT });

    // Every colour offered is a colour the theme defines, under both of its names.
    const undefinedColours = await page.evaluate((colours) => {
        const style = getComputedStyle(document.documentElement);
        return colours
            .flatMap((colour) => [`--color-${colour}-bg`, `--mindmap-relation-${colour}`])
            .filter((name) => style.getPropertyValue(name).trim() === '');
    }, COLOURS);
    expect(undefinedColours).toEqual([]);

    // And every one of them is reachable without scrolling: the eleven swatches — the ten and the
    // one for no colour — are laid out as a rectangle rather than stacked into a column taller
    // than the list opens. The same shape wherever a colour is chosen, the three selectors
    // sharing what makes it (lib/color-select.ts).
    for (const selector of ['Border colour of a new note', 'Background colour of a new note',
        'Colour of a new relation']) {
        await expectPaletteLayout(page, selector);
    }

    // Leave VISUALIZE mode, where the bare map is not double-clicked into a note.
    await mindmap.click({ position: { x: 20, y: 20 } });

    const plainRect = mindmap.locator('.mindmap-rect').first();
    const plainBorder = await plainRect.evaluate((el) => getComputedStyle(el).borderTopColor);
    const plainFill = await plainRect.evaluate((el) => getComputedStyle(el).backgroundColor);

    await choose(page, 'Border colour of a new note', 'Teal');
    await choose(page, 'Background colour of a new note', 'Pink');

    // Nothing already drawn is touched by the choice: it is the next note it colours.
    await expect(mindmap.locator('.note-border-teal')).toHaveCount(0);
    await expect(mindmap.locator('.note-bg-pink')).toHaveCount(0);

    // A note is made by double clicking the bare map where it should sit — clear of both the
    // notes the fixture holds, which stand to the right of here.
    await mindmap.dblclick({ position: { x: 60, y: 240 } });

    const madeRect = mindmap.locator('.note-border-teal .mindmap-rect');
    await expect(madeRect).toHaveCount(1, { timeout: TIMEOUT });
    await expect(mindmap.locator('.note-bg-pink .mindmap-rect')).toHaveCount(1);

    // And the two names reach the theme rather than falling back to what a note is drawn with.
    expect(await madeRect.evaluate((el) => getComputedStyle(el).borderTopColor)).not.toBe(plainBorder);
    expect(await madeRect.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(plainFill);

    // What was drawn opens again: the two colours are written onto the note.
    await awaitWrite(request, FILE, restoredAt);
    await page.reload();
    await expect(page.locator('.mindmap .note-border-teal')).toHaveCount(1, { timeout: 4 * TIMEOUT });
    await expect(page.locator('.mindmap .note-bg-pink')).toHaveCount(1);

    expect(pageErrors).toEqual([]);
});
