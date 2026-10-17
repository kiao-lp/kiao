import { test, expect, Locator, Page, workerApi, restoreFixture } from '../../harness';

/**
 * E2E: resizing a note by its own edges, and about its own middle.
 *
 * A note picked out on its own — control-clicked, which selects it without opening it — carries a
 * handle along each of its four sides. Dragging one is the wheel's alternative, for the hands and
 * the machines that have no wheel to turn: what it must do is what the wheel does, which is why
 * both are driven here.
 *
 * And whichever of the two is used, the note stays centred where it was: it is made bigger to be
 * read, not to be moved, and a note that wandered as it grew would have to be put back after
 * every turn. The centre is also the point every relation reaching the note aims at, so a note
 * that holds it is a map whose lines do not stir while one of its notes is resized.
 */

const TIMEOUT = 15000;
const FILE = 'folder-a/Mindmap.mmap.json';

/**
 * The specs of this map all write it — notes dragged, grouped, resized — and a worker runs them
 * one after another in one store, so each starts from the fixture rather than from whatever the
 * last of them left behind.
 */
test.beforeEach(async ({ request }) => { await restoreFixture(request, FILE); });

/** Where a note is on the screen: its middle, and how big it is drawn. */
const boxOf = async (note: Locator) => {
    const box = (await note.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, height: box.height };
};

/** A note of the file as it now stands, by what it says. */
const savedNote = async (says: string) => {
    const response = await fetch(`${workerApi()}/getFile?path=${encodeURIComponent(FILE)}`);
    const notes = response.ok ? (await response.json()).content.elements.notes : [];
    return notes.find((note: any) => note.content.includes(says));
};

/** The map, out of VISUALIZE and ready to be edited. */
const openMap = async (page: Page) => {
    await page.goto(FILE);
    const mindmap = page.locator('.mindmap');
    await expect(mindmap).toBeVisible({ timeout: TIMEOUT });
    await expect(mindmap.locator('.mindmap-rect')).toHaveCount(2, { timeout: TIMEOUT });

    // A first click where there is no element is what turns visualising into editing.
    await mindmap.click({ position: { x: 20, y: 20 } });
    return mindmap;
};

/** Drags one of a note's edges by `by` screen pixels, along whichever axis that edge is on. */
const dragEdge = async (page: Page, note: Locator, edge: string, by: number) => {
    const handle = note.locator(`.mindmap-note-resize-${edge}`);
    await expect(handle).toBeVisible({ timeout: TIMEOUT });

    const grip = (await handle.boundingBox())!;
    const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
    const to = edge === 'left' || edge === 'right'
        ? { x: from.x + by, y: from.y }
        : { x: from.x, y: from.y + by };

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
};

test('a note is resized by its edges, about its middle, and stays that size', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    const mindmap = await openMap(page);
    const note = mindmap.locator('.mindmap-rect').filter({ hasText: 'Note A' });

    // Nothing selected, nothing to drag: the edges are handles only of a note picked out.
    await expect(note.locator('.mindmap-note-resize')).toHaveCount(0);

    // Control picks it out without opening it, which is what leaves the edges reachable.
    await note.click({ modifiers: ['Control'] });
    await expect(note.locator('.mindmap-note-resize')).toHaveCount(4, { timeout: TIMEOUT });

    const before = await boxOf(note);

    // The side pulled 40 out, the one opposite giving way as far: 80 wider, centred where it was.
    await dragEdge(page, note, 'right', 40);
    const widened = await boxOf(note);
    expect(widened.width - before.width).toBeGreaterThan(70);
    expect(Math.abs(widened.x - before.x)).toBeLessThan(3);
    expect(Math.abs(widened.y - before.y)).toBeLessThan(3);
    expect(Math.abs(widened.height - before.height)).toBeLessThan(3);

    // The other axis is the same gesture, and the top edge does what the bottom one would.
    await dragEdge(page, note, 'top', -30);
    const heightened = await boxOf(note);
    expect(heightened.height - widened.height).toBeGreaterThan(50);
    expect(Math.abs(heightened.x - before.x)).toBeLessThan(3);
    expect(Math.abs(heightened.y - before.y)).toBeLessThan(3);

    // A size is a field of the file, not a state of the open editor.
    await expect.poll(async () => (await savedNote('Note A'))?.userBounds?.[2] ?? null, { timeout: TIMEOUT })
        .toBeGreaterThan(before.width + 70);

    await page.reload();
    await expect(page.locator('.mindmap')).toBeVisible({ timeout: TIMEOUT });
    const reopened = await boxOf(page.locator('.mindmap-rect').filter({ hasText: 'Note A' }));
    expect(Math.abs(reopened.width - heightened.width)).toBeLessThan(3);
    expect(Math.abs(reopened.height - heightened.height)).toBeLessThan(3);
    expect(Math.abs(reopened.x - before.x)).toBeLessThan(3);

    expect(pageErrors).toEqual([]);
});

test('the wheel resizes a note about the same middle', async ({ page }) => {
    const mindmap = await openMap(page);
    const note = mindmap.locator('.mindmap-rect').filter({ hasText: 'Note A' });
    const before = await boxOf(note);

    // Wheel over the note, which is the note's own and not the map's — the map zooms on ctrl.
    await page.mouse.move(before.x, before.y);
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await boxOf(note)).width, { timeout: TIMEOUT })
        .toBeGreaterThan(before.width + 10);

    const wider = await boxOf(note);
    expect(Math.abs(wider.x - before.x)).toBeLessThan(3);
    expect(Math.abs(wider.y - before.y)).toBeLessThan(3);

    // Shift makes it taller instead, about that same middle.
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await boxOf(note)).height, { timeout: TIMEOUT })
        .toBeGreaterThan(before.height + 10);
    await page.keyboard.up('Shift');

    const taller = await boxOf(note);
    expect(Math.abs(taller.x - before.x)).toBeLessThan(3);
    expect(Math.abs(taller.y - before.y)).toBeLessThan(3);
});

test('several notes picked out at once are moved together rather than resized', async ({ page }) => {
    const mindmap = await openMap(page);
    const noteA = mindmap.locator('.mindmap-rect').filter({ hasText: 'Note A' });
    const noteB = mindmap.locator('.mindmap-rect').filter({ hasText: 'Note B' });

    await noteA.click({ modifiers: ['Control'] });
    await expect(noteA.locator('.mindmap-note-resize')).toHaveCount(4, { timeout: TIMEOUT });

    // A second note joining it: no one edge says which of the two it would resize, so there is none.
    await noteB.click({ modifiers: ['Control'] });
    await expect(noteA.locator('.mindmap-note-resize')).toHaveCount(0);
    await expect(noteB.locator('.mindmap-note-resize')).toHaveCount(0);
});
