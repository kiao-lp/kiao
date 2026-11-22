import { test, expect, workerApi, flushViewState, resetViewState, type APIRequestContext, type Page } from '../harness';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * E2E: a video stepped through image by image and key image by key image, and cut into named
 * segments kept in a sidecar beside it.
 *
 * The clip is ten images a second for two seconds, with its key images forced at 0, 0.7 and 1.4 —
 * irregular on purpose, so that landing on one proves the key images were read out of the file
 * rather than guessed from a spacing. It is VP9 in an MP4, which the Chromium under test decodes
 * where it would not decode H.264. What is asserted here is what no unit test can say — that the
 * browser, seeking where the plugin tells it to, shows the image the plugin says it does, and that
 * the segments reach the store and come back from it.
 *
 * The clip is uploaded by the spec into `smoke/`, and taken away again with its sidecar: other
 * specs list that folder and the root of the store, and a fixture in the template would be in all
 * of their listings.
 */

// The first navigation compiles on a cold dev server, like every spec's that runs first on
// its stack.
const TIMEOUT = 15000;
const CLIP = 'smoke/segments-clip.mp4';
const SIDECAR = `${CLIP}.config.json`;
// Beside the spec rather than in the fixture template — the store must not seed it, the spec
// uploads it.
const CLIP_BYTES = readFileSync(join(__dirname, 'movie-edit/segments-clip.mp4'));

const put = async (request: APIRequestContext, path: string, buffer: Buffer, mimeType: string) => {
    const response = await request.fetch(`${workerApi()}/update?path=${encodeURIComponent(path)}`, {
        method: 'PUT',
        multipart: { file: { name: path.split('/').pop()!, mimeType, buffer } },
    });
    expect(response.ok(), `writing ${path}`).toBeTruthy();
};

const remove = (request: APIRequestContext, path: string) =>
    request.fetch(`${workerApi()}/delete?path=${encodeURIComponent(path)}`, { method: 'DELETE' });

/** The segments the sidecar holds — null while there is no sidecar. */
const storedSegments = async (request: APIRequestContext): Promise<unknown[] | null> => {
    const response = await request.get(`${workerApi()}/getFile?path=${encodeURIComponent(SIDECAR)}`);
    if (!response.ok()) return null;
    return (JSON.parse(await response.text()) as { segments?: unknown[] }).segments ?? null;
};

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const time = (page: Page) => page.getByTestId('movie-time');
const current = (page: Page) => page.getByTestId('movie-segment');
const panel = (page: Page) => page.getByTestId('segments-panel');

/** Where the browser's own clock stands. */
const clock = (page: Page) =>
    page.getByTestId('movie-player').evaluate((video: HTMLVideoElement) => video.currentTime);

/** Opens the clip, and waits for its file to have said where its images are. */
const open = async (page: Page) => {
    await page.goto(CLIP);
    await expect(page.locator('.movie-edit-controls')).toBeVisible({ timeout: TIMEOUT });
    await expect(button(page, 'Next key image')).toBeEnabled({ timeout: TIMEOUT });
};

test.beforeEach(async ({ request }) => {
    await remove(request, SIDECAR);
    await put(request, CLIP, CLIP_BYTES, 'video/mp4');
});

test.afterEach(async ({ page, request }) => {
    // Closed first, so that nothing it still owes the view state lands after the reset: the
    // segments panel was brought up into the right column, which is app-wide.
    await page.close();
    await resetViewState();
    await remove(request, SIDECAR);
    await remove(request, CLIP);
});

test('steps image by image and key image by key image, where the file says they are', async ({ page }) => {
    await open(page);
    await expect(time(page)).toHaveText('0:00.000');

    await button(page, 'Next image').click();
    await expect(time(page)).toHaveText('0:00.100');

    await button(page, 'Next key image').click();
    await expect(time(page)).toHaveText('0:00.700');
    // The browser's clock is in the middle of that image, where no rounding can miss it.
    expect(await clock(page)).toBeCloseTo(0.75, 3);

    await button(page, 'Next key image').click();
    await expect(time(page)).toHaveText('0:01.400');
    await expect(button(page, 'Next key image')).toBeDisabled();

    // From an image that is not a key image, back is the key image it follows.
    await button(page, 'Previous image').click();
    await expect(time(page)).toHaveText('0:01.300');
    await button(page, 'Previous key image').click();
    await expect(time(page)).toHaveText('0:00.700');

    // The arrows step the same way.
    await page.keyboard.press('ArrowRight');
    await expect(time(page)).toHaveText('0:00.800');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(time(page)).toHaveText('0:00.700');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(time(page)).toHaveText('0:00.000');
    await expect(button(page, 'Previous image')).toBeDisabled();
});

test('cuts a segment, and keeps it in a sidecar beside the video', async ({ page, request }) => {
    await open(page);

    // Nothing to save a position into yet.
    await expect(button(page, 'Set start')).toBeDisabled();
    await expect(button(page, 'Set end')).toBeDisabled();
    await expect(current(page)).toHaveText('No segment');

    // The document strip names the current segment and opens the panel one is chosen in.
    await current(page).click();
    await expect(panel(page)).toBeVisible({ timeout: TIMEOUT });

    await button(page, 'Next key image').click();
    await expect(time(page)).toHaveText('0:00.700');
    await panel(page).getByTestId('add-segment').click();
    const row = panel(page).getByTestId('segment-row');
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('segment-start')).toHaveText('0:00.700');
    await expect(row.getByTestId('segment-end')).toHaveText('0:00.700');
    await expect(current(page)).toHaveText('Segment 1');

    // Its end, a key image further on.
    await button(page, 'Next key image').click();
    await button(page, 'Set end').click();
    await expect(row.getByTestId('segment-end')).toHaveText('0:01.400');

    // Its start, an image before the key image it began on.
    await button(page, 'Previous key image').click();
    await button(page, 'Previous image').click();
    await expect(time(page)).toHaveText('0:00.600');
    await button(page, 'Set start').click();
    await expect(row.getByTestId('segment-start')).toHaveText('0:00.600');

    // Named in place.
    const name = row.getByTestId('segment-name');
    await name.fill('Intro');
    await name.press('Enter');
    await expect(current(page)).toHaveText('Intro');

    // All of it written beside the video.
    await expect.poll(() => storedSegments(request), { timeout: TIMEOUT })
        .toEqual([{ id: expect.any(String), name: 'Intro', startMs: 600, endMs: 1400 }]);

    // Each end is gone to by its time.
    await row.getByTestId('segment-end').click();
    await expect(time(page)).toHaveText('0:01.400');
    await row.getByTestId('segment-start').click();
    await expect(time(page)).toHaveText('0:00.600');

    // Opened again, it is there — and still the current one.
    await flushViewState(page);
    await page.reload();
    await expect(current(page)).toHaveText('Intro', { timeout: TIMEOUT });
    await expect(panel(page).getByTestId('segment-name')).toHaveValue('Intro');

    // Thrown away, from the store as well.
    await panel(page).getByTestId('delete-segment').click();
    await page.locator('.ant-popconfirm').getByRole('button', { name: 'Delete' }).click();
    await expect(panel(page).getByTestId('segment-row')).toHaveCount(0);
    await expect(current(page)).toHaveText('No segment');
    await expect.poll(() => storedSegments(request), { timeout: TIMEOUT }).toEqual([]);
});

test('reads back segments written into the sidecar elsewhere', async ({ page, request }) => {
    await open(page);
    await current(page).click();
    await expect(panel(page)).toContainText('No segments yet', { timeout: TIMEOUT });

    // An agent's turn, a hand in another editor: the sidecar changes under the open video.
    const written = { segments: [{ id: 'elsewhere', name: 'From elsewhere', startMs: 1400, endMs: 1900 }] };
    await put(request, SIDECAR, Buffer.from(JSON.stringify(written, null, 2)), 'application/json');
    const row = panel(page).getByTestId('segment-row');
    await expect(row.getByTestId('segment-name')).toHaveValue('From elsewhere', { timeout: TIMEOUT });

    // And it is a segment like any other: gone to by its start, and current once it has been.
    await row.getByTestId('segment-start').click();
    await expect(time(page)).toHaveText('0:01.400');
    await expect(current(page)).toHaveText('From elsewhere');
});
