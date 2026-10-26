import { test, expect, Page, restoreFixture } from '../../harness';

/**
 * E2E: the size of the note editing popup.
 *
 * The textarea takes all the height the toolbar leaves, and the popup is resizable
 * from its bottom right corner so a long note can be given more room — the textarea
 * following the popup instead of being clipped by it.
 *
 * Both microphone states are covered: VoiceTextArea renders the textarea on its own
 * when no microphone is available, and wraps it in a div when there is one, so the
 * sizing has to hold for two different DOM shapes (and win over antd's own
 * `textarea.ant-input { height: auto; resize: vertical }`).
 */

const TIMEOUT = 15000;
const FILE = 'folder-a/Mindmap.mmap.json';
const BOTTOM_STRIP = 16; // room kept for the resize grip and the voice input button

/**
 * The specs of this map all write it — notes dragged, grouped, resized — and a worker runs them
 * one after another in one store, so each starts from the fixture rather than from whatever the
 * last of them left behind.
 */
test.beforeEach(async ({ request }) => { await restoreFixture(request, FILE); });

const openNoteEditor = async (page: Page) => {
    await page.goto(FILE);
    const mindmap = page.locator('.mindmap');
    await expect(mindmap).toBeVisible({ timeout: TIMEOUT });

    // Leave VISUALIZE mode, then click the note to edit it.
    await mindmap.click({ position: { x: 20, y: 20 } });
    await page.locator('.mindmap-rect').filter({ hasText: 'Note A' }).click();

    const popup = page.locator('.mindmap-rich-text-editor-wrapper');
    await expect(popup).toBeVisible({ timeout: TIMEOUT });
    return popup;
};

const measure = async (page: Page) => {
    const popup = page.locator('.mindmap-rich-text-editor-wrapper');
    return {
        voiceWrappers: await popup.locator('.voice-input-wrapper').count(),
        popup: (await popup.boundingBox())!,
        textarea: (await popup.locator('textarea').boundingBox())!,
        toolbar: (await popup.locator('.mindmap-note-edit-toolbar').boundingBox())!
    };
};

for (const withMicrophone of [true, false]) {
    test(`note editor fills its popup and grows with it (microphone ${withMicrophone ? 'on' : 'off'})`, async ({ page }) => {
        if (!withMicrophone) {
            await page.addInitScript(() => {
                delete (window as any).SpeechRecognition;
                delete (window as any).webkitSpeechRecognition;
            });
        }

        const popup = await openNoteEditor(page);
        const before = await measure(page);

        expect(before.voiceWrappers).toBe(withMicrophone ? 1 : 0);

        // The whole toolbar is inside the popup and on one line. The popup is `overflow: hidden`
        // and the row wraps, so a row grown past the popup — by a control added to it — either
        // takes the trash button off the end or drops it onto a second line; the button's centre
        // being level with the first selector's box rules out both.
        const firstSelect = (await popup.locator('.mindmap-note-edit-toolbar .ant-select')
            .first().boundingBox())!;
        const trash = (await popup.getByTitle('Delete note').boundingBox())!;
        expect(trash.x + trash.width).toBeLessThanOrEqual(before.popup.x + before.popup.width);
        expect(trash.y + trash.height / 2).toBeGreaterThanOrEqual(firstSelect.y);
        expect(trash.y + trash.height / 2).toBeLessThanOrEqual(firstSelect.y + firstSelect.height);

        // The textarea starts right under the toolbar and runs down to the bottom strip.
        expect(before.textarea.y).toBeCloseTo(before.toolbar.y + before.toolbar.height, 0);
        const bottomGap = (before.popup.y + before.popup.height) - (before.textarea.y + before.textarea.height);
        expect(bottomGap).toBeLessThanOrEqual(BOTTOM_STRIP + 2);
        expect(before.textarea.width).toBeCloseTo(before.popup.width - 2, 0);

        // Drag the popup's bottom right grip.
        const grip = { x: before.popup.x + before.popup.width - 3, y: before.popup.y + before.popup.height - 3 };
        await page.mouse.move(grip.x, grip.y);
        await page.mouse.down();
        await page.mouse.move(grip.x + 160, grip.y + 130, { steps: 12 });
        await page.mouse.up();

        const after = await measure(page);

        // The popup grew, the textarea grew by exactly as much, and editing is still on.
        await expect(popup).toBeVisible();
        expect(after.popup.width).toBeGreaterThan(before.popup.width + 100);
        expect(after.popup.height).toBeGreaterThan(before.popup.height + 80);
        expect(after.textarea.width - before.textarea.width)
            .toBeCloseTo(after.popup.width - before.popup.width, 0);
        expect(after.textarea.height - before.textarea.height)
            .toBeCloseTo(after.popup.height - before.popup.height, 0);

        // The enlarged textarea is still the note's editor.
        const textarea = popup.locator('textarea');
        await textarea.fill('# Note A\n\nresized');
        await expect(textarea).toHaveValue(/resized/);
    });
}
