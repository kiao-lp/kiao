import { test, expect, APIRequestContext, workerApi } from '../harness';

/**
 * E2E: an open document follows the file on disk.
 *
 * The point of the feature is to watch a file change under an agent rather than discover it on
 * the next open, so the assertion is that the editor moves **without a reload**. Both halves are
 * covered: the file wins over an editor with nothing unsaved, and it does not win over one that
 * has an edit still inside the save debounce — that case is announced instead.
 *
 * The change is written through worker, which is where every write outside this browser
 * lands: Claude editing the store, a `git pull`, another editor.
 */

const TIMEOUT = 15000;
const FILE = 'smoke/disk-follow.md';
const updateUrl = () => `${workerApi()}/update?path=${encodeURIComponent(FILE)}`;
const AS_OPENED = '# Disk-follow fixture\n\nInitial content line.\n';

/** Write the file from outside the app, the way anything but this browser does. */
const writeFromOutside = async (request: APIRequestContext, content: string) => {
    const response = await request.fetch(updateUrl(), {
        method: 'PUT',
        multipart: { file: { name: 'disk-follow.md', mimeType: 'text/markdown', buffer: Buffer.from(content) } },
    });
    expect(response.ok()).toBeTruthy();
};

// Each test starts from known content rather than from what the previous one left: the second one
// deliberately ends with an edit still inside the debounce, which lands whenever it lands.
test.beforeEach(async ({ request }) => {
    await writeFromOutside(request, AS_OPENED);
});

test('a change written on disk reaches the open editor without a reload', async ({ page, request }) => {
    const marker = `written-elsewhere-${Date.now()}`;

    await page.goto(FILE);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    const editor = page.locator('.cm-content').first();
    await expect(editor).toContainText('Initial content line.', { timeout: TIMEOUT });

    await writeFromOutside(request, `# Disk-follow fixture\n\n${marker}\n`);

    // No reload anywhere in this test: the poll is what must bring the text in.
    await expect(editor).toContainText(marker, { timeout: TIMEOUT });
    await expect(editor).not.toContainText('Initial content line.');
});

test('an edit not written yet is kept, and the change on disk is announced', async ({ page, request }) => {
    const marker = `written-elsewhere-${Date.now()}`;

    await page.clock.install({ time: Date.now() - 60000 });
    await page.goto(FILE);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    const editor = page.locator('.cm-content').first();
    await expect(editor).toContainText('Initial content line.', { timeout: TIMEOUT });

    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.clock.pauseAt(Date.now());
    await page.keyboard.insertText('\ntyped here and not saved yet');

    await writeFromOutside(request, `# Disk-follow fixture\n\n${marker}\n`);

    // Advance the poll while each edit postpones autosave. Real keystroke delays can
    // exceed the save debounce under load, or let the warning expire before the assertion.
    for (let i = 0; i < 5; i++) {
        await page.keyboard.insertText('.');
        await page.clock.runFor(500);
    }

    await expect(page.locator('.ant-notification-notice')).toContainText('disk-follow.md changed on disk', { timeout: TIMEOUT });
    await expect(editor).toContainText('typed here and not saved yet');
    await expect(editor).not.toContainText(marker);
    expect(await (await request.get(`${workerApi()}/getFile?path=${encodeURIComponent(FILE)}`)).text()).toContain(marker);
});
