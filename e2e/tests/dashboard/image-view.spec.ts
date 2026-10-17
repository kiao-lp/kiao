import { test, expect, APIRequestContext, Page, workerApi } from '../harness';

/**
 * E2E: a picture read as one of its folder's — stepped through, and thrown away.
 *
 * The viewer's neighbours come from the file browser's own listing of the folder, so what is
 * asserted here is a promise no unit test can make: that the listing has arrived by the time the
 * arrows are drawn, that stepping actually navigates the app to the next document, and that a
 * deletion reaches the store and leaves the reader somewhere sensible.
 *
 * The folder is seeded by this spec rather than shipped in the fixture template: these tests
 * delete files, and a test that rebuilds what it needs survives being retried.
 */

const TIMEOUT = 10000;
const FOLDER = 'gallery';

/** A valid 1×1 PNG. Nothing here looks at the pixels; the file only has to be a picture. */
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

const write = async (request: APIRequestContext, path: string, buffer: Buffer, mimeType: string) => {
    const response = await request.fetch(`${workerApi()}/update?path=${encodeURIComponent(path)}`, {
        method: 'PUT',
        multipart: { file: { name: path.split('/').pop()!, mimeType, buffer } },
    });
    expect(response.ok(), `seeding ${path}`).toBeTruthy();
};

const exists = async (request: APIRequestContext, path: string) =>
    (await request.get(`${workerApi()}/getFile?path=${encodeURIComponent(path)}`)).ok();

/**
 * `names` as pictures in the gallery folder, plus a document that is not one: the viewer must
 * step from picture to picture, never onto the `.md` sitting between two of them.
 */
const seed = async (request: APIRequestContext, names: string[]) => {
    // Swept first: these tests delete pictures, and each one must start from the folder it
    // describes rather than from what its predecessor — or its own previous attempt — left.
    await request.fetch(`${workerApi()}/delete?path=${encodeURIComponent(FOLDER)}`, { method: 'DELETE' });
    await request.post(`${workerApi()}/createFolder?path=${encodeURIComponent(FOLDER)}`);
    for (const name of names) await write(request, `${FOLDER}/${name}`, PNG, 'image/png');
    await write(request, `${FOLDER}/notes.md`, Buffer.from('# Not a picture\n'), 'text/markdown');
};

const open = async (page: Page, name: string) => {
    await page.goto(`${FOLDER}/${name}`);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.image-gallery-controls')).toBeVisible({ timeout: TIMEOUT });
};

const counter = (page: Page) => page.getByTestId('image-counter');
const previous = (page: Page) => page.getByRole('button', { name: 'Previous image' });
const next = (page: Page) => page.getByRole('button', { name: 'Next image' });
const remove = (page: Page) => page.getByRole('button', { name: 'Delete image' });
/** The confirmation's own Delete, told apart from the banner's by the dialog it is in. */
const confirm = (page: Page) => page.locator('.ant-modal-confirm').getByRole('button', { name: 'Delete' });

const showing = async (page: Page, name: string) => {
    await expect(page).toHaveURL(new RegExp(`${FOLDER}/${name}$`), { timeout: TIMEOUT });
    await expect(page.locator('.cms-document-area img').first())
        .toHaveAttribute('src', new RegExp(encodeURIComponent(`${FOLDER}/${name}`)), { timeout: TIMEOUT });
};

test('steps through the folder\'s pictures, and stops at each end', async ({ page, request }) => {
    // Seeded out of order and mixed in case: the viewer's order is the browser's, not the disk's.
    await seed(request, ['Zebra.png', 'apple.png', 'beach.png']);

    await open(page, 'beach.png');
    await expect(counter(page)).toHaveText('2 / 3', { timeout: TIMEOUT });

    await next(page).click();
    await showing(page, 'Zebra.png');
    await expect(counter(page)).toHaveText('3 / 3');
    await expect(next(page)).toBeDisabled();

    // One step at a time, each waited for: which picture "previous" points at is read off the
    // open document, so a second click fired before the first has landed aims at the same one.
    await previous(page).click();
    await showing(page, 'beach.png');
    await previous(page).click();
    await showing(page, 'apple.png');
    await expect(counter(page)).toHaveText('1 / 3');
    await expect(previous(page)).toBeDisabled();
});

test('the arrow keys step the same way', async ({ page, request }) => {
    await seed(request, ['one.png', 'two.png']);

    await open(page, 'one.png');
    await expect(counter(page)).toHaveText('1 / 2', { timeout: TIMEOUT });

    await page.keyboard.press('ArrowRight');
    await showing(page, 'two.png');

    await page.keyboard.press('ArrowLeft');
    await showing(page, 'one.png');
});

test('deleting the open picture removes it and moves on to the next', async ({ page, request }) => {
    await seed(request, ['first.png', 'second.png', 'third.png']);

    await open(page, 'second.png');
    await expect(counter(page)).toHaveText('2 / 3', { timeout: TIMEOUT });

    await remove(page).click();
    await expect(page.locator('.ant-modal-confirm')).toContainText('second.png', { timeout: TIMEOUT });
    await confirm(page).click();

    // The reader lands on the picture that took its place, in a folder now one shorter.
    await showing(page, 'third.png');
    await expect(counter(page)).toHaveText('2 / 2', { timeout: TIMEOUT });
    expect(await exists(request, `${FOLDER}/second.png`)).toBeFalsy();
});

test('deleting the last picture of a folder goes back to the folder', async ({ page, request }) => {
    await seed(request, ['alone.png']);

    await open(page, 'alone.png');
    await expect(counter(page)).toHaveText('1 / 1', { timeout: TIMEOUT });

    await remove(page).click();
    await confirm(page).click();

    // Nothing left to look at: the browser, on the folder the picture was in.
    await expect(page).toHaveURL(new RegExp(`${FOLDER}$`), { timeout: TIMEOUT });
    await expect(page.getByTestId(`browser-item-${FOLDER}/notes.md`)).toBeVisible({ timeout: TIMEOUT });
});
