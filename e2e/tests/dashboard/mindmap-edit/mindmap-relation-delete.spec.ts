import { test, expect, awaitWrite, modifiedAt, restoreFixture } from '../../harness';

/**
 * E2E: deleting a note that a relation points at.
 *
 * The end of a relation is drawn from the bounds of the note it targets, so a note deleted out
 * from under one used to leave an end pointing at nothing: the editor threw on the next render
 * and the saved file could no longer be opened. Deletion now takes those ends with it, and a
 * relation left with fewer than two ends goes too — from the note editor's delete button and
 * from the Delete key alike, which is why both are exercised here.
 */

const TIMEOUT = 15000;
const FILE = 'folder-a/Relations.mmap.json';

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

test('mindmap: deleting a note takes the relations that pointed at it', async ({ page, request }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto(FILE);
    const mindmap = page.locator('.mindmap');
    await expect(mindmap).toBeVisible({ timeout: TIMEOUT });

    // One anchor per relation: One—Two and Two—Three.
    await expect(mindmap.locator('.relation-anchor')).toHaveCount(2, { timeout: TIMEOUT });

    // Leave VISUALIZE mode by clicking where there is no element.
    await mindmap.click({ position: { x: 20, y: 20 } });

    // Delete Note One from the note editor's toolbar.
    await mindmap.locator('.mindmap-rect').filter({ hasText: 'Note One' }).click();
    await expect(page.locator('.mindmap-rich-text-editor-wrapper')).toBeVisible({ timeout: TIMEOUT });
    await page.getByTitle('Delete note').click();

    await expect(mindmap.getByText('Note One')).toHaveCount(0);
    await expect(mindmap.getByText('Note Two')).toBeVisible();
    await expect(mindmap.locator('.relation-anchor')).toHaveCount(1);

    // Delete Note Three with the Delete key. The key deletes the one element the map is on — what
    // is selected and what the pointer is over, taken together — and does nothing at all while
    // anything the first deletion left is still counted beside it. So the map is cleared first,
    // and the ring around the note says the click landed before the key is pressed.
    await mindmap.click({ position: { x: 20, y: 20 } });
    const noteThree = mindmap.locator('.mindmap-rect').filter({ hasText: 'Note Three' });
    const box = (await noteThree.boundingBox())!;
    await page.keyboard.down('Control');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.up('Control');
    await expect(mindmap.locator('.selected')).toHaveCount(1, { timeout: TIMEOUT });
    await expect(mindmap.locator('.selected').filter({ hasText: 'Note Three' })).toHaveCount(1);
    await page.keyboard.press('Delete');

    await expect(mindmap.getByText('Note Three')).toHaveCount(0);
    await expect(mindmap.locator('.relation-anchor')).toHaveCount(0);

    // What was saved opens again: this is what a dangling end used to make impossible.
    await awaitWrite(request, FILE, restoredAt);
    await page.reload();
    await expect(page.locator('.mindmap')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.mindmap').getByText('Note Two')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.mindmap').getByText('Note One')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
});
