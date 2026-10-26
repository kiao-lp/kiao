import { test, expect, Locator, Page, awaitWrite, modifiedAt, restoreFixture } from '../../harness';

/**
 * E2E: what a relation is drawn as, chosen from the menu its centre opens.
 *
 * A relation is a line by default and carries no width. Given one it becomes a shape running
 * along the same curve — the same width at both ends is a rectangle, a point at one end against a
 * width at the other is a triangle — and the shape follows the bend rather than lying across it.
 * The rectangle is an empty one, drawn as its own outline; the triangle is filled in. Its colour,
 * how wide it is and which way round a triangle points are chosen from the same menu.
 */

const TIMEOUT = 15000;
const FILE = 'folder-a/Relations.mmap.json';

const menuOf = (page: Page) => page.locator('.relation-context-menu');

/** Opens the menu of the first relation on the map, which is the one between One and Two. */
const openMenu = async (page: Page) => {
    await page.locator('.mindmap .relation-anchor').first().click();
    await expect(menuOf(page)).toBeVisible({ timeout: TIMEOUT });
};

/**
 * The list that is open.
 *
 * antd does not take a closed list out of the page: it plays a leave animation over it, and for as
 * long as that lasts the list still has a box and still carries every class it had. So the one
 * being read is the one that is neither hidden nor on its way out — anything looser matches two
 * lists at once, which Playwright reports as a strict-mode violation rather than as a wait.
 */
const OPEN_LIST = '.ant-select-dropdown:visible:not([class*="-leave"])';

/** Picks from one of the menu's selectors, each of which is named by what it sets. */
const choose = async (page: Page, selector: string, option: string) => {
    // Opened onto a page showing no list, so the one that comes up is the only one there.
    await expect(page.locator(OPEN_LIST)).toHaveCount(0, { timeout: TIMEOUT });
    await menuOf(page).locator(`.ant-select[title="${selector}"]`).click();
    await page.locator(OPEN_LIST)
        .locator(`.ant-select-item-option[title="${option}"]`).click();
};

/** The corners of a drawn body, which is a polyline and nothing else. */
const cornersOf = async (body: Locator): Promise<number[][]> => {
    const numbers = (await body.getAttribute('d'))!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const corners: number[][] = [];
    for (let at = 0; at < numbers.length; at += 2) corners.push([numbers[at], numbers[at + 1]]);
    return corners;
};

/** Whether that half of a relation comes to a point where it meets its note. */
const comesToAPoint = async (body: Locator): Promise<boolean> => {
    const corners = await cornersOf(body);
    return corners[0].join() === corners[corners.length - 1].join();
};

/** Whether that half is drawn as an outline rather than filled in — the empty rectangle. */
const isHollow = (body: Locator): Promise<boolean> =>
    body.evaluate((path) => getComputedStyle(path).fill === 'none');

/**
 * What the disc at the relation's centre is drawn in. It is a join — it fills the notch the two
 * halves leave on the outside of a bend — so on ink it is the ink's own colour and no mark of its
 * own, and inside an empty rectangle it is nothing at all.
 */
const joinColorOf = (page: Page): Promise<string> =>
    page.locator('.mindmap .relation-anchor-join').first()
        .evaluate((join) => getComputedStyle(join).backgroundColor);

/** How wide that half is across, which for the base of a triangle is the base. */
const acrossOf = async (body: Locator): Promise<number> => {
    const ys = (await cornersOf(body)).map(([, y]) => y);
    return Math.max(...ys) - Math.min(...ys);
};

/** Where the map starts from, so a write of the editor's own can be waited for by its time. */
let restoredAt = 0;

/**
 * Five specs drive this map and every one of them writes it — a note deleted, a relation added, a
 * bend saved. A worker runs them one after another in one store, so each starts from the fixture
 * rather than from whatever the last of them left behind.
 */
test.beforeEach(async ({ request }) => {
    await restoreFixture(request, FILE);
    restoredAt = await modifiedAt(request, FILE);
});

test('mindmap: a relation is drawn as a line, a rectangle or a triangle', async ({ page, request }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto(FILE);
    const mindmap = page.locator('.mindmap');
    await expect(mindmap).toBeVisible({ timeout: TIMEOUT });
    await expect(mindmap.locator('.relation-anchor')).toHaveCount(2, { timeout: TIMEOUT });

    // Leave VISUALIZE mode, then open the menu of the relation between Note One and Note Two.
    await mindmap.click({ position: { x: 20, y: 20 } });
    await openMenu(page);

    // A line to begin with, so the menu offers no width to pick and nothing to turn round.
    await expect(mindmap.locator('.relation-body')).toHaveCount(0);
    await expect(menuOf(page).locator('.ant-select[title="Body width"]')).toHaveCount(0);
    await expect(page.getByTitle('Turn the triangle round')).toHaveCount(0);

    // A rectangle: both halves of that relation become a body, the other relation stays a line.
    await choose(page, 'Body', 'Rectangle');
    await expect(mindmap.locator('.relation-body')).toHaveCount(2, { timeout: TIMEOUT });
    await expect(mindmap.locator('.relation-curve')).toHaveCount(2);
    expect(await comesToAPoint(mindmap.locator('.relation-body').first())).toBe(false);

    // And an empty one: its own outline, with no ink inside it. Each half is left open where the
    // two meet at the centre, so the outline runs from note to note rather than being cut in two
    // by a line across the middle of the body.
    expect(await isHollow(mindmap.locator('.relation-body').first())).toBe(true);
    expect(await mindmap.locator('.relation-body').first().getAttribute('d')).not.toContain('Z');

    // Empty of the centre join as well: there is no notch for it to fill and it would read as a
    // dot in the middle of the shape.
    await expect.poll(() => joinColorOf(page), { timeout: TIMEOUT }).toBe('rgba(0, 0, 0, 0)');

    // A triangle comes to a point at the first of the relation's two ends, and the menu now
    // offers to turn it round.
    await choose(page, 'Body', 'Triangle');
    await expect.poll(() => comesToAPoint(mindmap.locator('.relation-body').first()), { timeout: TIMEOUT })
        .toBe(true);
    await expect(page.getByTitle('Turn the triangle round')).toBeVisible();

    // A triangle is filled in, both halves of it: its point is the whole of what it says, and an
    // outline would leave it a hairline exactly where it matters.
    expect(await isHollow(mindmap.locator('.relation-body').first())).toBe(false);
    expect(await isHollow(mindmap.locator('.relation-body').nth(1))).toBe(false);

    // And it keeps the join, which on filled ink is the ink and not a mark of its own.
    await expect.poll(() => joinColorOf(page), { timeout: TIMEOUT }).not.toBe('rgba(0, 0, 0, 0)');

    // The width selector sets the base, and leaves the point a point.
    await choose(page, 'Body width', '48');
    await expect.poll(() => acrossOf(mindmap.locator('.relation-body').nth(1)), { timeout: TIMEOUT })
        .toBeGreaterThan(40);
    expect(await comesToAPoint(mindmap.locator('.relation-body').first())).toBe(true);

    // Turning it round moves the point to the other end, and nothing else about it changes.
    await page.getByTitle('Turn the triangle round').click();
    await expect.poll(() => comesToAPoint(mindmap.locator('.relation-body').nth(1)), { timeout: TIMEOUT })
        .toBe(true);
    expect(await comesToAPoint(mindmap.locator('.relation-body').first())).toBe(false);

    // A colour is the whole relation's, so it is carried once and read by everything drawn.
    await choose(page, 'Colour', 'Blue');
    await expect(mindmap.locator('.relation-color-blue')).toHaveCount(1, { timeout: TIMEOUT });

    // What was chosen opens again: the widths and the colour are fields of the file.
    await awaitWrite(request, FILE, restoredAt);
    await page.reload();
    await expect(page.locator('.mindmap .relation-body')).toHaveCount(2, { timeout: TIMEOUT });
    await expect(page.locator('.mindmap .relation-color-blue')).toHaveCount(1);

    // And back to the line it was, which carries no width at all.
    const chosenAt = await modifiedAt(request, FILE);
    await page.locator('.mindmap').click({ position: { x: 20, y: 20 } });
    await openMenu(page);
    await choose(page, 'Body', 'Line');
    await expect(page.locator('.mindmap .relation-body')).toHaveCount(0, { timeout: TIMEOUT });
    await expect(page.locator('.mindmap .relation-curve')).toHaveCount(4);

    expect(pageErrors).toEqual([]);

    // The fixture is shared with the specs that run after this one, so the last change is left
    // written rather than in flight.
    await awaitWrite(request, FILE, chosenAt);
});
