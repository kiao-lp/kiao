import { test, expect, fileUrl } from '../harness';

/**
 * E2E: markdown edit → autosave → reload → persistence.
 *
 * The single most load-bearing user flow in the tool: type into a file and have
 * it survive a reload. The markdown editor autosaves on a 1s debounce (no explicit
 * save button), so we type, wait past the debounce, reload from scratch, and assert
 * the new text is still there.
 */

const TIMEOUT = 15000;

test('markdown edits autosave and survive a reload', async ({ page }) => {
    const marker = `roundtrip-${Date.now()}`;

    await page.goto('smoke/roundtrip.md');
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });

    // The CodeMirror source pane holds the editable markdown.
    const editor = page.locator('.cm-content').first();
    await expect(editor).toBeVisible({ timeout: TIMEOUT });
    await expect(editor).toContainText('Initial content line.');

    // Append a unique marker at the end of the document.
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(`\n${marker}`);

    // Autosave is debounced at 1s, and the file is where it lands: waiting for the marker to be
    // in it is both shorter than outlasting the debounce and a stronger thing to know.
    await expect.poll(() => fetch(fileUrl('smoke/roundtrip.md')).then(r => r.text()), { timeout: TIMEOUT })
        .toContain(marker);

    // Reload from scratch: a fresh document load must reflect the saved marker.
    await page.reload();
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    const reloaded = page.locator('.cm-content').first();
    await expect(reloaded).toBeVisible({ timeout: TIMEOUT });
    await expect(reloaded).toContainText(marker, { timeout: TIMEOUT });
    // The original content is still present too — we appended, not replaced.
    await expect(reloaded).toContainText('Initial content line.');
});
