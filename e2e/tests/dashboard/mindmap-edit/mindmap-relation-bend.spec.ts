import { test, expect, APIRequestContext, fileUrl, Locator, restoreFixture } from '../../harness';

/**
 * E2E: bending a relation by moving its centre.
 *
 * A relation is one curve through a centre between its two notes. Dragging that centre — the
 * anchor on the line — writes a `bend` on the relation and the curve bows through it; the anchor's
 * menu offers to put it back. Both are exercised here, with a reload in between: the bend is a
 * field of the saved file and not a state of the open editor.
 *
 * That it is a curve and not a corner is read off the drawing itself: each half is written as a
 * quadratic, and a quadratic whose control point sits on the straight line between its ends is
 * the straight line. So how far that point lies off it is how much the relation bows.
 */

const TIMEOUT = 15000;
const FILE = 'folder-a/Relations.mmap.json';

/** Where an element is on the screen, by its middle. */
const centreOf = async (locator: Locator) => {
    const box = (await locator.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** How far a drawn half of a relation bows off the straight line between its two ends. */
const bowOf = async (curve: Locator): Promise<number> => {
    const [x0, y0, cx, cy, x1, y1] = (await curve.getAttribute('d'))!
        .match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    return Math.hypot(cx - (x0 + x1) / 2, cy - (y0 + y1) / 2);
};

/**
 * The bend, as the file holds it — null until the drag's write has landed.
 *
 * Waited for by what it carries rather than by the file's time, because the map is written
 * **twice** over this test: once shortly after it opens, putting back the bounds it measured its
 * notes at, and once a debounce after the drag, with the bend. Waiting for *a* write since the
 * fixture was restored takes the first of the two — and where the measurement lands after the drag
 * rather than before it, which is what a loaded machine does, the reload then opens the map as it
 * was before the bend.
 */
const storedBend = async (request: APIRequestContext): Promise<number[] | null> => {
    const response = await request.get(fileUrl(FILE));
    const { content } = JSON.parse(await response.text());
    return content.elements.relations
        .find((relation: { id: string }) => relation.id === 'REL-one-two')?.bend ?? null;
};

/**
 * Five specs drive this map and every one of them writes it — a note deleted, a relation added, a
 * bend saved. A worker runs them one after another in one store, so each starts from the fixture
 * rather than from whatever the last of them left behind.
 */
test.beforeEach(async ({ request }) => {
    await restoreFixture(request, FILE);
});

test('mindmap: a relation bends through the centre it is dragged to', async ({ page, request }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto(FILE);
    const mindmap = page.locator('.mindmap');
    await expect(mindmap).toBeVisible({ timeout: TIMEOUT });
    await expect(mindmap.locator('.relation-anchor')).toHaveCount(2, { timeout: TIMEOUT });

    // Leave VISUALIZE mode by clicking where there is no element.
    await mindmap.click({ position: { x: 20, y: 20 } });

    // The relation between Note One and Note Two runs flat across the map, so its centre starts
    // level with them and any move of it is a bend.
    const anchor = mindmap.locator('.relation-anchor').first();
    const before = await centreOf(anchor);

    // It is straight to begin with: both halves are drawn as the line between their ends.
    const half = mindmap.locator('.relation-curve').first();
    expect(await bowOf(half)).toBeLessThan(1);

    // Drag the centre 80px up, in steps slow enough for the map to accumulate the movement.
    await page.mouse.move(before.x, before.y);
    await page.mouse.down();
    await page.mouse.move(before.x, before.y - 40, { steps: 10 });
    await page.waitForTimeout(120);
    await page.mouse.move(before.x, before.y - 80, { steps: 10 });
    await page.waitForTimeout(120);
    await page.mouse.up();

    // The centre follows the pointer as far as it went, and no further.
    const bent = await centreOf(anchor);
    expect(Math.abs(bent.y - (before.y - 80))).toBeLessThan(6);
    expect(Math.abs(bent.x - before.x)).toBeLessThan(6);

    // And what is drawn through it is a curve, not a pair of straight pieces.
    expect(await bowOf(half)).toBeGreaterThan(15);
    await expect(mindmap.locator('.relation-end')).toHaveCount(4);

    // What was saved opens bent.
    await expect.poll(() => storedBend(request), { timeout: TIMEOUT }).not.toBeNull();
    await page.reload();
    await expect(page.locator('.mindmap')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.mindmap .relation-anchor')).toHaveCount(2, { timeout: TIMEOUT });

    const reopened = await centreOf(page.locator('.mindmap .relation-anchor').first());
    expect(Math.abs(reopened.y - bent.y)).toBeLessThan(10);

    // Straighten it from the anchor's own menu: a press that moves nothing opens it.
    await page.locator('.mindmap').click({ position: { x: 20, y: 20 } });
    await page.mouse.click(reopened.x, reopened.y);
    const straighten = page.getByTitle('Straighten relation');
    await expect(straighten).toBeVisible({ timeout: TIMEOUT });
    await straighten.click();

    const straightened = await centreOf(page.locator('.mindmap .relation-anchor').first());
    expect(Math.abs(straightened.y - before.y)).toBeLessThan(10);
    expect(await bowOf(page.locator('.mindmap .relation-curve').first())).toBeLessThan(1);

    // A straight relation has nothing to straighten, so the menu offers it no more.
    await page.mouse.click(straightened.x, straightened.y);
    await expect(page.getByTitle('Delete relation')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.getByTitle('Straighten relation')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
});
