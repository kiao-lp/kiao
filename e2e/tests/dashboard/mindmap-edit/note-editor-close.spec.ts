import { test, expect, awaitWrite, modifiedAt, restoreFixture } from '../../harness';

/**
 * E2E: closing the note editing popup with the keyboard.
 *
 * Enter writes a line in a note, so it is Ctrl+Enter that says the note is written: the popup
 * goes, the map goes back to being edited with the note still selected, and what was typed is
 * kept and saved exactly as clicking away from the popup keeps it.
 */

const TIMEOUT = 15000;
const FILE = 'folder-a/Mindmap.mmap.json';

/** Where the map starts from, so a write of the editor's own can be waited for by its time. */
let restoredAt = 0;

/** The specs of this map all write it, and a worker runs them one after another in one store. */
test.beforeEach(async ({ request }) => {
    await restoreFixture(request, FILE);
    restoredAt = await modifiedAt(request, FILE);
});

test('Ctrl+Enter closes the note editor and keeps what was typed', async ({ page, request }) => {
    await page.goto(FILE);
    const mindmap = page.locator('.mindmap');
    await expect(mindmap).toBeVisible({ timeout: TIMEOUT });

    // Leave VISUALIZE mode, then click the note to edit it.
    await mindmap.click({ position: { x: 20, y: 20 } });
    await page.locator('.mindmap-rect').filter({ hasText: 'Note A' }).click();

    const popup = page.locator('.mindmap-rich-text-editor-wrapper');
    await expect(popup).toBeVisible({ timeout: TIMEOUT });

    await popup.locator('textarea').fill('Note A closed by keyboard');
    await page.keyboard.press('Control+Enter');

    // The popup is gone, and the note on the map wears the text — no newline of its own added.
    await expect(popup).not.toBeVisible();
    const note = page.locator('.mindmap-rect').filter({ hasText: 'closed by keyboard' });
    await expect(note).toBeVisible({ timeout: TIMEOUT });

    // The map is still being edited: clicking the note opens its editor again straight away.
    await note.click();
    await expect(popup).toBeVisible({ timeout: TIMEOUT });
    await expect(popup.locator('textarea')).toHaveValue('Note A closed by keyboard');
    await page.keyboard.press('Control+Enter');

    // And the text went to the file, not just to the screen — waited for first, since a
    // reload wins the race against a write still on its way out.
    await awaitWrite(request, FILE, restoredAt);
    await page.reload();
    await expect(page.locator('.mindmap-rect').filter({ hasText: 'closed by keyboard' }))
        .toBeVisible({ timeout: TIMEOUT });
});
