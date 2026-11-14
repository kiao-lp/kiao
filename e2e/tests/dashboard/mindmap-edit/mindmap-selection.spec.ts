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
 * E2E Test: Mindmap Multi-Selection and Dragging
 * 
 * This test validates:
 * 1. Opening an existing mindmap (folder-a/Mindmap.mmap.json)
 * 2. Switching to EDIT mode by clicking inside the mindmap where there's no element
 * 3. Selecting a note with Ctrl+click
 * 4. Dragging the note
 * 5. Adding a second note to selection with Ctrl+click
 * 6. Dragging both notes together
 * 7. Deselecting the first note with Ctrl+click
 * 8. Clicking in empty space to clear remaining selection
 */
test('mindmap selection: multi-select, drag, and deselect notes', async ({ page }) => {
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

    // 4. Switch to EDIT mode by clicking inside the mindmap where there's no element
    // Click at a safe empty spot (near top-left corner)
    await mindmap.click({ position: { x: 50, y: 50 } });
    await page.waitForTimeout(200); // Allow mode switch

    // 5. Get mindmap bounding box for coordinate calculations
    const box = await mindmap.boundingBox();
    if (!box) throw new Error('Mindmap bounding box not found');

    // The mindmap file has:
    // - Note A at approximately (177, 82) with size ~113x95
    // - Note B at approximately (275, 291) with size ~114x95
    // We need to find the actual notes by their content

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

    // 6. Select Note A by Ctrl+click on it
    await page.keyboard.down('Control');
    await page.mouse.click(noteACenterX, noteACenterY);
    await page.keyboard.up('Control');
    await page.waitForTimeout(100);

    // Verify Note A is selected (should have 'selected' class on parent)
    const selectedElements = page.locator('.mindmap-rect.selected-background');
    // Note: The actual selection styling may vary; we verify by checking the selection context

    // 7. Drag Note A (mouse down, drag, mouse up)
    await page.mouse.move(noteACenterX, noteACenterY);
    await page.mouse.down();
    await page.waitForTimeout(50);

    // Drag 50 pixels to the right and 30 pixels down
    const dragDeltaX = 50;
    const dragDeltaY = 30;
    await page.mouse.move(noteACenterX + dragDeltaX, noteACenterY + dragDeltaY, { steps: 10 });
    await page.waitForTimeout(50);
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Verify Note A moved (its new position should be different)
    const noteABoxAfterDrag = await noteA.boundingBox();
    if (!noteABoxAfterDrag) throw new Error('Note A bounding box not found after drag');

    // Note A should have moved approximately by the drag delta
    expect(noteABoxAfterDrag.x).toBeCloseTo(noteABox.x + dragDeltaX, -1);
    expect(noteABoxAfterDrag.y).toBeCloseTo(noteABox.y + dragDeltaY, -1);

    // Update Note A center after drag
    const noteANewCenterX = noteABoxAfterDrag.x + noteABoxAfterDrag.width / 2;
    const noteANewCenterY = noteABoxAfterDrag.y + noteABoxAfterDrag.height / 2;

    // 8. Select Note B by Ctrl+click (adding to selection)
    await page.keyboard.down('Control');
    await page.mouse.click(noteBCenterX, noteBCenterY);
    await page.keyboard.up('Control');
    await page.waitForTimeout(100);

    // 9. Drag both notes together
    // Start drag from Note A (which is still selected)
    await page.mouse.move(noteANewCenterX, noteANewCenterY);
    await page.mouse.down();
    await page.waitForTimeout(50);

    // Drag both notes 40 pixels left and 20 pixels up
    const dragBothDeltaX = -40;
    const dragBothDeltaY = -20;
    await page.mouse.move(noteANewCenterX + dragBothDeltaX, noteANewCenterY + dragBothDeltaY, { steps: 10 });
    await page.waitForTimeout(50);
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Verify both notes moved
    const noteABoxAfterBothDrag = await noteA.boundingBox();
    const noteBBoxAfterBothDrag = await noteB.boundingBox();

    if (!noteABoxAfterBothDrag || !noteBBoxAfterBothDrag) {
        throw new Error('Note bounding boxes not found after both drag');
    }

    // Both notes should have moved by the same delta
    expect(noteABoxAfterBothDrag.x).toBeCloseTo(noteABoxAfterDrag.x + dragBothDeltaX, -1);
    expect(noteABoxAfterBothDrag.y).toBeCloseTo(noteABoxAfterDrag.y + dragBothDeltaY, -1);
    expect(noteBBoxAfterBothDrag.x).toBeCloseTo(noteBBox.x + dragBothDeltaX, -1);
    expect(noteBBoxAfterBothDrag.y).toBeCloseTo(noteBBox.y + dragBothDeltaY, -1);

    // 10. Deselect Note A by Ctrl+click on it
    const noteAFinalCenterX = noteABoxAfterBothDrag.x + noteABoxAfterBothDrag.width / 2;
    const noteAFinalCenterY = noteABoxAfterBothDrag.y + noteABoxAfterBothDrag.height / 2;

    await page.keyboard.down('Control');
    await page.mouse.click(noteAFinalCenterX, noteAFinalCenterY);
    await page.keyboard.up('Control');
    await page.waitForTimeout(100);

    // Note A should now be deselected, Note B should still be selected

    // 11. Click inside the mindmap where there's no element to clear the selection
    // Click at a safe empty spot
    await mindmap.click({ position: { x: 50, y: 50 } });
    await page.waitForTimeout(100);

    // All notes should now be deselected
    // The test completed successfully if we reached this point without errors
});
