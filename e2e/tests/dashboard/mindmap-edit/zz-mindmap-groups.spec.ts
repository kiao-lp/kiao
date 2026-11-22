import { test, expect, restoreFixture } from '../../harness';

const TIMEOUT = 10000;
const FILE = 'folder-a/Mindmap.mmap.json';

/**
 * The specs of this map all write it — notes dragged, grouped, resized — and a worker runs them
 * one after another in one store, so each starts from the fixture rather than from whatever the
 * last of them left behind.
 */
test.beforeEach(async ({ request }) => { await restoreFixture(request, FILE); });

/**
 * E2E Test: Mindmap Note Groups
 * 
 * This test validates:
 * 1. Creating two notes in a mindmap
 * 2. Selecting both notes and grouping them with Ctrl+G
 * 3. Deselecting all notes
 * 4. Clicking on one note auto-selects both grouped notes
 * 5. Ctrl+click to deselect one note individually
 */
test('mindmap groups: create group and verify auto-selection', async ({ page }) => {
    page.on('console', msg => {
        if (msg.type() === 'error' || msg.type() === 'warning') {
            console.log(`BROWSER ${msg.type()}: ${msg.text()}`);
        }
    });
    page.on('pageerror', err => console.log(`BROWSER ERROR: ${err.message}`));

    // 1. Navigate to the folder containing the test mindmap
    await page.goto('folder-a');
    await expect(page).toHaveURL(/folder-a/);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });

    // 2. Open the Mindmap.mmap.json file (double-click opens; single-click selects)
    const browserItem = page.getByTestId(`browser-item-${FILE}`);
    await expect(browserItem).toBeVisible({ timeout: TIMEOUT });
    await browserItem.dblclick();

    // 3. Wait for the mindmap component to be visible
    const mindmap = page.locator('.mindmap');
    await expect(mindmap).toBeVisible({ timeout: TIMEOUT });

    // 4. Switch to EDIT mode by clicking inside the mindmap
    await mindmap.click({ position: { x: 50, y: 50 } });
    await page.waitForTimeout(200);

    // 5. Find the notes
    const noteA = mindmap.getByText('Note A');
    const noteB = mindmap.getByText('Note B');

    await expect(noteA).toBeVisible({ timeout: TIMEOUT });
    await expect(noteB).toBeVisible({ timeout: TIMEOUT });

    // Get bounding boxes for the notes
    const noteABox = await noteA.boundingBox();
    const noteBBox = await noteB.boundingBox();

    if (!noteABox || !noteBBox) throw new Error('Note bounding boxes not found');

    // Calculate center positions
    const noteACenterX = noteABox.x + noteABox.width / 2;
    const noteACenterY = noteABox.y + noteABox.height / 2;
    const noteBCenterX = noteBBox.x + noteBBox.width / 2;
    const noteBCenterY = noteBBox.y + noteBBox.height / 2;

    // 6. Select Note A with Ctrl+click (to avoid entering edit mode)
    await page.keyboard.down('Control');
    await page.mouse.click(noteACenterX, noteACenterY);
    await page.keyboard.up('Control');
    await page.waitForTimeout(100);

    // 7. Ctrl+click to add Note B to selection
    await page.keyboard.down('Control');
    await page.mouse.click(noteBCenterX, noteBCenterY);
    await page.keyboard.up('Control');
    await page.waitForTimeout(100);

    // 8. Check that both notes are selected by looking at the .selected class
    const selectedNotes = mindmap.locator('.selected .mindmap-rect');
    await expect(selectedNotes).toHaveCount(2);

    // 9. Create a note group with Ctrl+G
    await page.keyboard.press('Control+g');
    await page.waitForTimeout(200);

    // 10. Click in empty space to deselect all - get mindmap box and click far from notes
    const box = await mindmap.boundingBox();
    if (!box) throw new Error('Mindmap bounding box not found');

    // Click at a position that's definitely empty (far bottom-right corner of mindmap)
    await page.mouse.click(box.x + box.width - 50, box.y + box.height - 50);
    await page.waitForTimeout(200);

    // Verify no notes are selected
    await expect(selectedNotes).toHaveCount(0);

    // 11. Click on Note A - both notes should now be selected due to the group
    await page.mouse.click(noteACenterX, noteACenterY);
    await page.waitForTimeout(100);

    // Verify both notes are selected
    await expect(selectedNotes).toHaveCount(2);

    // 12. Ctrl+click on Note B to deselect it individually
    await page.keyboard.down('Control');
    await page.mouse.click(noteBCenterX, noteBCenterY);
    await page.keyboard.up('Control');
    await page.waitForTimeout(100);

    // Verify only Note A is still selected
    await expect(selectedNotes).toHaveCount(1);
});

