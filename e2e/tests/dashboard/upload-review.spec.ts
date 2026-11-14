import { test, expect, APIRequestContext, Page, workerApi } from '../harness';

/**
 * E2E: an upload is staged, read and decided on before any of it is in the store.
 *
 * The upload zone no longer writes into the folder being browsed. It opens a staging area — a
 * directory of the store no listing shows — uploads into that, has the documents converted there,
 * and then asks, file by file, whether each is to be imported or thrown away. Four things have to
 * agree for that to work and nothing else crosses all of them: `POST /staging` and its bounded
 * discard, the conversion, the review dialog's own rules, and the moveBatch that carries an
 * imported document's index along with it as a subsidiary.
 *
 * The fixtures are written by the test rather than committed, in a folder of its own, for the
 * reason document-index.spec.ts gives: the suite shares one store per Playwright worker, and a document that
 * has been sitting there is a document that may already be indexed.
 */

const TIMEOUT = 10000;
const FOLDER = 'upload-review-demo';

/** A message from Claire, in the shape a mail client actually writes one. */
const MESSAGE = [
    'From: Claire Dubois <claire@example.org>',
    'To: Alex <alex@example.com>',
    'Date: Tue, 03 Mar 2026 09:15:00 +0100',
    'Subject: Budget 2027',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="utf-8"',
    '',
    'Le budget est fige au 12 avril.',
    '',
].join('\r\n');

const REJECTED = MESSAGE.replace('Subject: Budget 2027', 'Subject: Publicite')
    .replace('Le budget est fige au 12 avril.', 'Offre exceptionnelle, cliquez ici.');

/** Hands the (hidden) file input of the upload zone a set of files, as the picker would. */
const uploadInto = async (page: Page, files: { name: string; body: string }[]) => {
    await page.locator('.kiao-upload-zone input[type="file"]:not([webkitdirectory])').setInputFiles(
        files.map(f => ({ name: f.name, mimeType: 'message/rfc822', buffer: Buffer.from(f.body) })));
};

const exists = async (request: APIRequestContext, path: string): Promise<boolean> =>
    (await request.get(`${workerApi()}/getFile?path=${encodeURIComponent(path)}`)).ok();

const openFolder = async (page: Page) => {
    await page.goto(FOLDER);
    // A fresh page loads the plugin assembly before the folder renders.
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('.kiao-upload-zone')).toBeVisible({ timeout: TIMEOUT });
};

test.describe('reviewing an upload', () => {
    test.beforeEach(async ({ request }) => {
        await request.post(`${workerApi()}/createFolder?path=${encodeURIComponent(FOLDER)}`);
    });

    test.afterEach(async ({ request }) => {
        await request.delete(`${workerApi()}/delete?path=${encodeURIComponent(FOLDER)}`);
    });

    test('the documents are read in the dialog, and only the kept ones land in the folder', async ({ page, request }) => {
        await openFolder(page);
        await uploadInto(page, [
            { name: 'budget.eml', body: MESSAGE },
            { name: 'pub.eml', body: REJECTED },
            { name: 'notes.txt', body: 'a plain note, which nothing converts' },
        ]);

        // 1. Nothing is in the folder yet. The dialog is what arrives.
        await expect(page.getByTestId('upload-review-tree')).toBeVisible({ timeout: TIMEOUT });
        await expect(page.getByTestId('browser-item-' + FOLDER + '/budget.eml')).toHaveCount(0);

        // 2. Clicking a converted document shows what it says — which is the whole reason for the
        //    detour: the decision below is taken on the content and not on a file name.
        await page.getByTestId('upload-review-node-budget.eml').click();
        // An index is Markdown, so it is shown as the document it is: the subject is a heading and
        // not a line beginning with a hash.
        await expect(page.getByTestId('upload-review-index').locator('h1'))
            .toHaveText('Budget 2027', { timeout: TIMEOUT });
        await expect(page.getByTestId('upload-review-index')).toContainText('Le budget est fige au 12 avril.');

        // 3. Safe import waits on a decision for every document whose text was shown — the two
        //    converted mails, and the plain note too, since a note needs nothing to be readable.
        await expect(page.getByTestId('upload-review-safe')).toBeDisabled();
        await page.getByTestId('upload-review-import').click();
        await expect(page.getByTestId('upload-review-safe')).toBeDisabled();

        await page.getByTestId('upload-review-node-pub.eml').click();
        await expect(page.getByTestId('upload-review-index')).toContainText('Offre exceptionnelle', { timeout: TIMEOUT });
        await expect(page.getByTestId('upload-review-index').locator('h1')).toHaveText('Publicite');
        await page.getByTestId('upload-review-delete').click();
        await expect(page.getByTestId('upload-review-safe')).toBeDisabled(); // the note is still open

        await page.getByTestId('upload-review-node-notes.txt').click();
        await expect(page.getByTestId('upload-review-index')).toContainText('a plain note', { timeout: TIMEOUT });
        await page.getByTestId('upload-review-import').click();

        // 4. The choice is reported where the file is.
        await expect(page.getByTestId('upload-review-node-pub.eml')).toContainText('delete');
        await expect(page.getByTestId('upload-review-node-budget.eml')).toContainText('import');

        await expect(page.getByTestId('upload-review-safe')).toBeEnabled();
        await page.getByTestId('upload-review-safe').click();

        // 5. What was kept is in the folder, with the index it was converted into: an index is a
        //    subsidiary, so it travels with its document and the review never had to name it.
        await expect(page.getByTestId(`browser-item-${FOLDER}/budget.eml`)).toBeVisible({ timeout: TIMEOUT });
        await expect(page.getByTestId(`browser-item-${FOLDER}/notes.txt`)).toBeVisible();
        expect(await exists(request, `${FOLDER}/budget.eml.index.md`), 'the index came along').toBeTruthy();

        // 6. And what was refused is gone from the disk, not filed somewhere out of sight.
        expect(await exists(request, `${FOLDER}/pub.eml`)).toBeFalsy();
        const listing = await (await request.get(`${workerApi()}/list?path=`)).json() as { path: string }[];
        expect(listing.map(e => e.path)).not.toContain('.kiao-uploads');
    });

    test('the red button imports the lot without asking, undecided files included', async ({ page, request }) => {
        await openFolder(page);
        await uploadInto(page, [{ name: 'budget.eml', body: MESSAGE }, { name: 'pub.eml', body: REJECTED }]);
        await expect(page.getByTestId('upload-review-tree')).toBeVisible({ timeout: TIMEOUT });

        await expect(page.getByTestId('upload-review-safe')).toBeDisabled();
        await page.getByTestId('upload-review-unsafe').click(); // no confirmation of any kind

        await expect(page.getByTestId(`browser-item-${FOLDER}/budget.eml`)).toBeVisible({ timeout: TIMEOUT });
        await expect(page.getByTestId(`browser-item-${FOLDER}/pub.eml`)).toBeVisible();
    });

    test('cancelling keeps nothing, and leaves the staging area behind on neither side', async ({ page, request }) => {
        await openFolder(page);
        await uploadInto(page, [{ name: 'budget.eml', body: MESSAGE }]);
        await expect(page.getByTestId('upload-review-tree')).toBeVisible({ timeout: TIMEOUT });

        await page.getByTestId('upload-review-cancel').click();
        await expect(page.getByTestId('upload-review-tree')).toHaveCount(0);

        expect(await exists(request, `${FOLDER}/budget.eml`)).toBeFalsy();
        const staging = await request.get(`${workerApi()}/list?path=${encodeURIComponent('.kiao-uploads')}`);
        expect(((await staging.json()) as { path: string }[]).filter(e => e.path.includes('/u-'))).toEqual([]);
    });
});
