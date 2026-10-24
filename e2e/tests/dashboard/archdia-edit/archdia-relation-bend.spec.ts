import { test, expect, Locator, awaitWrite, fileUrl, modifiedAt, restoreFixture } from '../../harness';

/**
 * E2E: bending an archdia relation by dragging the centre it passes through, and finding that
 * centre in the first place.
 *
 * A relation is one quadratic through a centre between its two elements, and that centre carries
 * a handle: dragging it writes a `bend` into the LAYOUT block and the curve bows through where it
 * was put. The drag itself is covered by unit tests, which drive it in jsdom by reaching straight
 * for the handle's node. What only a browser can answer is whether a hand could have reached for
 * it at all — a disc of six pixels, painted with nothing until the pointer is already on it, is
 * not something anyone finds. So what is asserted here is the reaching: a pointer somewhere near
 * the curve lights the relation up and brings the centre out, and a press a few pixels off that
 * centre still takes hold of it.
 */

const TIMEOUT = 15000;
const FILE = 'smoke/relations.arch.md';

/** Where an element is on the screen, by its middle. */
const centreOf = async (locator: Locator) => {
    const box = (await locator.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** How far a relation's curve bows off the straight line between its two ends. */
const bowOf = async (curve: Locator): Promise<number> => {
    const [x0, y0, cx, cy, x1, y1] = (await curve.getAttribute('d'))!
        .match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    return Math.hypot(cx - (x0 + x1) / 2, cy - (y0 + y1) / 2);
};

/** What the browser actually paints an element with, once every rule has had its say. */
const painted = (locator: Locator, property: string) => locator.evaluate(
    (node, prop) => getComputedStyle(node).getPropertyValue(prop), property);

/** Where the map starts from, so a write of the editor's own can be waited for by its time. */
let restoredAt = 0;

test.beforeEach(async ({ request }) => {
    await restoreFixture(request, FILE);
    restoredAt = await modifiedAt(request, FILE);
});

test('archdia: a relation is found by pointing near it, and bends through the centre it is dragged to', async ({ page, request }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto(FILE);
    const svg = page.locator('.archdia-svg');
    // Twice the usual margin: the first archdia opened on a cold shard waits for vite to
    // compile the plugin while the run's other shards boot beside it.
    await expect(svg).toBeVisible({ timeout: 2 * TIMEOUT });

    const handle = svg.locator('.archdia-relation-handle');
    await expect(handle).toHaveCount(1, { timeout: TIMEOUT });

    const line = svg.locator('.archdia-relation-line');
    expect(await bowOf(line)).toBeLessThan(1);

    // At rest the diagram is the diagram: the centre is there but shows nothing.
    expect(Number(await painted(handle, 'opacity'))).toBeLessThan(0.05);

    // A pointer that comes near the curve — not onto the centre — brings the centre out and
    // lights the band up, which is what says the relation answers to a hand.
    const centre = await centreOf(handle);
    await page.mouse.move(centre.x - 70, centre.y + 4);
    await expect.poll(() => painted(handle, 'opacity').then(Number), { timeout: TIMEOUT })
        .toBeGreaterThan(0.5);
    expect(Number(await painted(svg.locator('.archdia-relation-hit'), 'opacity'))).toBeLessThan(1);

    // Taking hold of it a few pixels off its middle still takes hold of it.
    const grab = { x: centre.x + 4, y: centre.y - 4 };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x, grab.y - 40, { steps: 10 });
    await page.waitForTimeout(120);
    await page.mouse.move(grab.x, grab.y - 80, { steps: 10 });
    await page.waitForTimeout(120);
    await page.mouse.up();

    // The centre followed the pointer as far as it went, and no further.
    const bent = await centreOf(handle);
    expect(Math.abs(bent.y - (centre.y - 80))).toBeLessThan(6);
    expect(Math.abs(bent.x - centre.x)).toBeLessThan(6);

    // And what is drawn through it is a curve, not the straight line it was.
    expect(await bowOf(line)).toBeGreaterThan(15);

    // The bend is a field of the saved file, not a state of the open editor.
    await awaitWrite(request, FILE, restoredAt);
    expect(await (await request.get(fileUrl(FILE))).text()).toContain('"bends"');

    await page.reload();
    await expect(page.locator('.archdia-svg')).toBeVisible({ timeout: TIMEOUT });
    const reopened = await centreOf(page.locator('.archdia-relation-handle'));
    expect(Math.abs(reopened.y - bent.y)).toBeLessThan(10);

    // Double-clicking the centre straightens the relation again.
    await page.mouse.dblclick(reopened.x, reopened.y);
    await expect.poll(() => bowOf(page.locator('.archdia-relation-line')), { timeout: TIMEOUT })
        .toBeLessThan(1);

    expect(pageErrors).toEqual([]);
});

test('archdia: a component says it can be taken hold of when the pointer reaches it', async ({ page }) => {
    await page.goto(FILE);
    const svg = page.locator('.archdia-svg');
    // Twice the usual margin, as above: either test may be the shard's first archdia.
    await expect(svg).toBeVisible({ timeout: 2 * TIMEOUT });

    const alpha = svg.locator('.archdia-component').first();
    const box = alpha.locator('.archdia-component-box');
    const atRest = await painted(box, 'stroke');

    await alpha.hover();
    await expect.poll(() => painted(box, 'stroke'), { timeout: TIMEOUT }).not.toBe(atRest);

    // And it lets go of the mark again once the pointer has moved on.
    await page.mouse.move(5, 5);
    await expect.poll(() => painted(box, 'stroke'), { timeout: TIMEOUT }).toBe(atRest);
});
