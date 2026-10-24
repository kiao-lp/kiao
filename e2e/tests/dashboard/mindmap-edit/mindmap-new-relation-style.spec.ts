import { test, expect, APIRequestContext, Locator, Page, fileUrl, resetViewState, restoreFixture } from '../../harness';

/**
 * E2E: the style the next relation is drawn in, chosen from the top bar.
 *
 * A relation is a plain line unless the map has been told otherwise, and a map is usually drawn
 * with relations that all say the same thing — so the shape of the body, its width and its colour
 * are chosen once for the map, beside the style new notes are made with, rather than through each
 * relation's own menu. The triangle is offered both ways round: a relation is pulled out of one
 * note towards another, so which of the two it comes to a point at is a choice made here.
 */

const TIMEOUT = 15000;
const FILE = 'folder-a/Relations.mmap.json';

/**
 * The list that is open.
 *
 * antd does not take a closed list out of the page: it plays a leave animation over it, and for as
 * long as that lasts the list still has a box and still carries every class it had. So the one
 * being read is the one that is neither hidden nor on its way out — anything looser matches two
 * lists at once, which Playwright reports as a strict-mode violation rather than as a wait.
 */
const OPEN_LIST = '.ant-select-dropdown:visible:not([class*="-leave"])';

/** Picks from one of the bar's selectors, each of which is named by what it sets. */
const choose = async (page: Page, selector: string, option: string) => {
    // Opened onto a page showing no list, so the one that comes up is the only one there.
    await expect(page.locator(OPEN_LIST)).toHaveCount(0, { timeout: TIMEOUT });
    await page.locator(`.mindmap-panel .ant-select[title="${selector}"]`).click();
    await page.locator(OPEN_LIST)
        .locator(`.ant-select-item-option[title="${option}"]`).click();
};

/** Whether that half of a relation comes to a point where it meets its note. */
const comesToAPoint = async (body: Locator): Promise<boolean> => {
    const numbers = (await body.getAttribute('d'))!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const corners: number[][] = [];
    for (let at = 0; at < numbers.length; at += 2) corners.push([numbers[at], numbers[at + 1]]);
    return corners[0].join() === corners[corners.length - 1].join();
};

/** Pulls a relation out of one note and lets it go over another, which is shift and a drag. */
const relate = async (page: Page, from: Locator, to: Locator) => {
    const start = (await from.boundingBox())!;
    const end = (await to.boundingBox())!;

    await page.keyboard.down('Shift');
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
};

/**
 * How many relations the store actually holds of the colour this spec draws in.
 *
 * The editor writes on a debounce and this spec draws twice, so the file passes through a state
 * holding the first relation and not yet the second. Waiting for the modification time to move is
 * waiting for that state as readily as for the last one — the first write is already in by the
 * time the second relation is drawn — and the reload then opens half of what was drawn. Polling
 * what is in the file waits for the write that is actually being asserted.
 */
const violetRelations = async (request: APIRequestContext) => {
    const { content } = await (await request.fetch(fileUrl(FILE))).json();
    return content.elements.relations.filter((relation: any) => relation.color === 'violet').length;
};

/**
 * Five specs drive this map and every one of them writes it — a note deleted, a relation added, a
 * bend saved. A worker runs them one after another in one store, so each starts from the fixture
 * rather than from whatever the last of them left behind.
 */
test.beforeEach(async ({ request }) => {
    await restoreFixture(request, FILE);
});

/**
 * And the style the bar is set to is remembered app-wide, not with the map — so this spec, which
 * is the only one that changes it, puts it back. What it asserts first is a bar offering a line
 * and no width at all, which is the bar a store that has never been told otherwise gives.
 */
test.afterEach(resetViewState);

test('mindmap: a new relation is drawn in the style the top bar is set to', async ({ page, request }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto(FILE);
    const mindmap = page.locator('.mindmap');
    await expect(mindmap).toBeVisible({ timeout: TIMEOUT });
    await expect(mindmap.locator('.relation-anchor')).toHaveCount(2, { timeout: TIMEOUT });

    // Leave VISUALIZE mode, where a note is neither selected nor pulled from.
    await mindmap.click({ position: { x: 20, y: 20 } });

    // A line to begin with, which is stroked rather than filled: there is no width to pick.
    await expect(mindmap.locator('.relation-body')).toHaveCount(0);
    await expect(page.locator('.mindmap-panel .ant-select[title="Body width of a new relation"]'))
        .toHaveCount(0);

    await choose(page, 'Body of a new relation', 'Triangle');
    await choose(page, 'Body width of a new relation', '48');
    await choose(page, 'Colour of a new relation', 'Violet');

    // Nothing already on the map is touched by the choice: it is the next relation it styles.
    await expect(mindmap.locator('.relation-body')).toHaveCount(0);

    await relate(page,
        mindmap.locator('.mindmap-rect').filter({ hasText: 'Note One' }),
        mindmap.locator('.mindmap-rect').filter({ hasText: 'Note Three' }));

    // The relation made is a triangle in that colour, coming to a point at the note it was
    // pulled out of — both halves of it being a body, and the two older relations still lines.
    await expect(mindmap.locator('.relation-anchor')).toHaveCount(3, { timeout: TIMEOUT });
    await expect(mindmap.locator('.relation-body')).toHaveCount(2, { timeout: TIMEOUT });
    await expect(mindmap.locator('.relation-color-violet')).toHaveCount(1);
    expect(await comesToAPoint(mindmap.locator('.relation-body').first())).toBe(true);
    expect(await comesToAPoint(mindmap.locator('.relation-body').nth(1))).toBe(false);

    // The triangle the other way round is the same shape read from the other end.
    await choose(page, 'Body of a new relation', 'Triangle the other way round');
    await relate(page,
        mindmap.locator('.mindmap-rect').filter({ hasText: 'Note One' }),
        mindmap.locator('.mindmap-rect').filter({ hasText: 'Note Two' }));

    await expect(mindmap.locator('.relation-body')).toHaveCount(4, { timeout: TIMEOUT });
    const madeBackwards = mindmap.locator('.relation-body').nth(2);
    await expect.poll(() => comesToAPoint(madeBackwards), { timeout: TIMEOUT }).toBe(false);
    expect(await comesToAPoint(mindmap.locator('.relation-body').nth(3))).toBe(true);

    // What was drawn opens again: the style is written onto the relations, as widths and a colour.
    await expect.poll(() => violetRelations(request), { timeout: TIMEOUT }).toBe(2);
    await page.reload();
    await expect(page.locator('.mindmap .relation-body')).toHaveCount(4, { timeout: TIMEOUT });
    await expect(page.locator('.mindmap .relation-color-violet')).toHaveCount(2);

    expect(pageErrors).toEqual([]);
});
