import { test, expect, APIRequestContext, Page, workerApi } from '../harness';

/**
 * E2E: converting documents into their sibling index, from the context menu.
 *
 * Four things have to agree and nothing else crosses all of them: the Go converters, the
 * `POST /reindex` contract, the *Rebuild search index* command in the file browser, and the
 * subsidiary rules that keep the index out of the listing and offer it as a companion instead.
 *
 * The fixtures are written by the test rather than committed, in a folder of its own. That is not
 * tidiness: the suite shares one store per Playwright worker, another spec searches the store root, and a
 * search *also* writes indexes — so a document that has been sitting there is a document that may
 * already be indexed, and "1 document indexed" would be true or false depending on the order the
 * specs ran in.
 */

const TIMEOUT = 10000;
const FOLDER = 'index-demo';

/** A message from Claire, in the shape a mail client actually writes one. */
const MESSAGE = [
    'From: Claire Dubois <claire@example.org>',
    'To: Alex <alex@example.com>',
    'Date: Tue, 03 Mar 2026 09:15:00 +0100',
    'Subject: =?utf-8?Q?Rapport_trimestriel?=',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="utf-8"',
    '',
    'Bonjour Alex,',
    '',
    'Le rapport est joint. La migration est prevue le 14 mars.',
    '',
].join('\r\n');

const writeFile = async (request: APIRequestContext, folder: string, name: string, body: string) => {
    const response = await request.post(`${workerApi()}/upload`, {
        multipart: { path: folder, file: { name, mimeType: 'message/rfc822', buffer: Buffer.from(body) } },
    });
    expect(response.ok(), `writing ${folder}/${name}`).toBeTruthy();
};

/** Right-clicks a row and runs one command of the file context menu. */
const runFromContextMenu = async (page: Page, path: string, label: string) => {
    await page.getByTestId(`browser-item-${path}`).click({ button: 'right' });
    const menu = page.locator('.ant-dropdown:not(.ant-dropdown-hidden)').first();
    await expect(menu).toBeVisible({ timeout: TIMEOUT });
    await menu.getByText(label, { exact: true }).click();
};

test.describe('document indexes', () => {
    test.beforeEach(async ({ request }) => {
        await request.post(`${workerApi()}/createFolder?path=${encodeURIComponent(FOLDER)}`);
        await writeFile(request, FOLDER, 'rapport.eml', MESSAGE);
    });

    test.afterEach(async ({ request }) => {
        await request.delete(`${workerApi()}/delete?path=${encodeURIComponent(FOLDER)}`);
    });

    test('a document is converted from the context menu, and stays converted', async ({ page, request }) => {
        await page.goto(FOLDER);
        await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
        await expect(page.getByTestId(`browser-item-${FOLDER}/rapport.eml`)).toBeVisible({ timeout: TIMEOUT });

        // 1. The command converts it, and says what it did.
        await runFromContextMenu(page, `${FOLDER}/rapport.eml`, 'Rebuild search index');
        await expect(page.locator('.ant-message')).toContainText('1 document indexed', { timeout: TIMEOUT });

        // 2. What it wrote is the message, as Markdown: the subject as the title, the envelope as
        //    fields, the body under a heading. This is the whole point of converting rather than
        //    dumping text, and it is readable from the store like any other file.
        const index = await request.get(
            `${workerApi()}/getFile?path=${encodeURIComponent(`${FOLDER}/rapport.eml.index.md`)}`);
        expect(index.ok(), 'the .index.md should exist').toBeTruthy();
        const markdown = await index.text();
        expect(markdown).toContain('# Rapport trimestriel');
        expect(markdown).toContain('**From:** Claire Dubois <claire@example.org>');
        expect(markdown).toContain('**Date:** 2026-03-03T09:15:00+01:00');
        expect(markdown).toContain('La migration est prevue le 14 mars.');

        // 3. The index is a subsidiary, so the listing shows the document and not its index —
        //    otherwise every converted document would double the folder it is in.
        await expect(page.getByTestId(`browser-item-${FOLDER}/rapport.eml.index.md`)).toHaveCount(0);

        // 4. Asking again converts nothing: the index is on disk and current.
        await page.locator('.ant-message').waitFor({ state: 'detached', timeout: TIMEOUT });
        await runFromContextMenu(page, `${FOLDER}/rapport.eml`, 'Rebuild search index');
        await expect(page.locator('.ant-message')).toContainText('1 already up to date', { timeout: TIMEOUT });
    });

    test('a folder is converted whole, and the index is what search then reads', async ({ page, request }) => {
        await page.goto(FOLDER);
        await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
        await expect(page.getByTestId(`browser-item-${FOLDER}/rapport.eml`)).toBeVisible({ timeout: TIMEOUT });

        // The empty area of the browser aims the command at the folder being browsed, which is how
        // a whole folder of documents is converted in one gesture.
        await page.locator('.cms-folder-browser-area').click({ button: 'right', position: { x: 40, y: 10 } });
        const menu = page.locator('.ant-dropdown:not(.ant-dropdown-hidden)').first();
        await expect(menu).toBeVisible({ timeout: TIMEOUT });
        await menu.getByText('Rebuild search index', { exact: true }).click();
        await expect(page.locator('.ant-message')).toContainText('1 document indexed', { timeout: TIMEOUT });

        // A word that exists only inside the message is now findable, and the hit is reported
        // against the document — never against the index that was actually scanned.
        const response = await request.get(
            `${workerApi()}/search?path=${encodeURIComponent(FOLDER)}&query=${encodeURIComponent('"prevue le 14 mars"')}`);
        expect(response.ok()).toBeTruthy();
        const files = ((await response.json()).results as { file: string }[]).map(r => r.file);
        expect(files).toEqual([`${FOLDER}/rapport.eml`]);
    });
});
