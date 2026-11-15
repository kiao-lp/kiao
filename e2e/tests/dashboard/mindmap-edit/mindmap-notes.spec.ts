import { test, expect } from '../../harness';

const TIMEOUT = 10000;

/**
 * E2E Test: Mindmap and Note Creation
 *
 * This test validates:
 * 1. Creation of a new mindmap document via the New dropdown menu.
 * 2. Switching to EDIT mode by clicking the mindmap.
 * 3. Creating notes by double clicking the bare map where they should sit.
 * 4. Typing content into the notes.
 */
test('mindmap creation: create new mindmap and add notes', async ({ page }) => {
    page.on('console', msg => {
        if (msg.type() === 'error' || msg.type() === 'warning') {
            console.log(`BROWSER ${msg.type()}: ${msg.text()}`);
        }
    });
    page.on('pageerror', err => console.log(`BROWSER ERROR: ${err.message}`));

    // 1. Preparation: Navigate to a specific folder to avoid cluttering root
    await page.goto('folder-a');
    await expect(page).toHaveURL(/folder-a/);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });

    // Cleanup: Ensure the file doesn't exist from a previous run
    const newFilePath = "folder-a/New Mindmap.mmap.json";
    const existingFile = page.getByTestId(`browser-item-${newFilePath}`);
    if (await existingFile.isVisible()) {
        await existingFile.hover();
        await page.keyboard.press('Delete');
        await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
        await expect(existingFile).not.toBeVisible();
    }

    // 2. Create Mindmap via the New dropdown menu
    // Ensure no active selection interferes
    await page.keyboard.press('Escape');

    const newButton = page.getByTestId('new-button-toolbar');
    await expect(newButton).toBeVisible();
    await newButton.click();
    await page.locator('.ant-dropdown-menu').getByText('Mindmap', { exact: true }).click();

    // Wait for the file to be created and appear in the browser list
    const browserItem = page.getByTestId(`browser-item-${newFilePath}`);
    await expect(browserItem).toBeVisible({ timeout: TIMEOUT });

    // Dismiss the rename modal that opens automatically after creation
    const renameInput = page.getByTestId('rename-input');
    await expect(renameInput).toBeVisible({ timeout: TIMEOUT });
    await expect(renameInput).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(renameInput).not.toBeVisible();

    // Open the mindmap explicitly (double-click opens; single-click selects)
    await browserItem.dblclick();

    // Wait for the mindmap component to be visible
    // The mindmap plugin renders a div with class 'mindmap'
    const mindmap = page.locator('.mindmap');
    await expect(mindmap).toBeVisible({ timeout: TIMEOUT });

    // 3. Enter Edit Mode
    // Click inside the mindmap to switch from VISUALIZE to EDIT mode
    // We click in the center or a safe empty spot
    await mindmap.click({ position: { x: 100, y: 100 } });

    // 4. Create Note 1
    // A note is made by double clicking the bare map where it should sit — there is no shortcut
    // for it. It is born at the point, then measured, centred on it and opened for editing a
    // moment later (SETTLING_DELAY in hooks/useNote.ts), which is what the wait is for.
    await mindmap.dblclick({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);

    // The note is now the selected element, in edit mode: what is typed goes into it.
    const note1Content = "First Note Content";
    await page.keyboard.type(note1Content, { delay: 50 });
    // Press Escape does not work because CommandDispatcher is disabled in EDIT_MODIFY_ELEMENT mode.
    // We must click on the mindmap background to clear selection and finish editing.
    // Click at a safe location (e.g. top left) ensuring we don't click the note itself.
    await mindmap.click({ position: { x: 10, y: 10 } });

    // 5. Create Note 2
    await mindmap.dblclick({ position: { x: 500, y: 200 } });
    await page.waitForTimeout(500);

    const note2Content = "Second Note Content";
    await page.keyboard.type(note2Content, { delay: 50 });
    // Click outside to finish
    await mindmap.click({ position: { x: 10, y: 10 } });

    // 6. Assertions
    // Verify that the text exists in the mindmap
    await expect(mindmap.getByText(note1Content)).toBeVisible();
    await expect(mindmap.getByText(note2Content)).toBeVisible();

    // 7. Cleanup (Optional, but good practice to remove test files)
    // Select the file in browser and delete it? 
    // Or just leave it as other tests seem to do specific cleanup or rely on separate test envs.
    // folder-creation.spec.ts does cleanup.
    // We are currently viewing the file. We can try to delete it.
    // To delete, we might need to go back to the list or use the command if available in this view.
    // Let's clean up by navigating back and deleting.

    // Go back to file list
    await page.goto('folder-a');
    const browserItemToDelete = page.getByTestId(`browser-item-${newFilePath}`);
    await browserItemToDelete.hover();
    await page.keyboard.press('Delete');
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(browserItemToDelete).not.toBeVisible();
});
