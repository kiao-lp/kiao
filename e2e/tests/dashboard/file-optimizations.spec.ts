import { test, expect, APIRequestContext, Page, workerApi, resetViewState } from '../harness';

/**
 * E2E: what the store is carrying that it need not be, and what removing it does to the store.
 *
 * The view is opened from the "…" menu and answers two questions about the whole store, so every
 * assertion here crosses the lot — a server-side walk that reads the files it must read, a table of
 * radios over what it found, and a filesystem afterwards. Three promises, and each of them is one
 * only the real stack can show:
 *
 *  - **Identical is read, not measured.** Two files of the same size and different content are not a
 *    group. That is the case a size-only scan gets wrong, and it is the one that would quietly
 *    destroy somebody's work.
 *  - **A location and a name, chosen separately.** The good name is on the copy in the wrong folder,
 *    which is the ordinary case and the whole reason the choice is in two halves. What is kept is
 *    the two put together.
 *  - **Answered group by group, run in one press.** The store is what holds duplicates, so the tool
 *    that cleans it acts on the store: every group whose two halves were chosen goes in one press
 *    and one confirmation. A group left half-chosen is not touched by it — asserted on the disk,
 *    because that is where an over-eager batch would show.
 *  - **Keeping one repairs the links to the others.** A consolidation is a move, not a delete, so a
 *    document that pointed at a copy that went now points at the one that stayed. A hygiene tool
 *    that broke a store full of documents would be worse than no hygiene tool.
 *
 * The fixture is made and unmade by the spec: a worker's store is shared by every spec it runs, and
 * a duplicate left behind would show up in somebody else's scan.
 */

const TIMEOUT = 20000;
const DEMO = 'optim-demo';

/** The two copies, and the third file that is only the same *length* as them. */
const COPY_A = `${DEMO}/assets/IMG_4471.png`;
const COPY_B = `${DEMO}/scratch/logo.png`;
const LOOKALIKE = `${DEMO}/scratch/decoy.png`;
const KEPT = `${DEMO}/assets/logo.png`;

/** A second pair, answered too: what the one press has to reach beyond the group it stands in. */
const SECOND_A = `${DEMO}/assets/IMG_9002.png`;
const SECOND_B = `${DEMO}/scratch/banner.png`;
const SECOND_KEPT = `${DEMO}/assets/banner.png`;

/** A third pair, deliberately left half-answered: what the one press must not reach. */
const UNTOUCHED_A = `${DEMO}/media/shot.png`;
const UNTOUCHED_B = `${DEMO}/scratch/shot-copy.png`;

const SHARED = 'the very same bytes, twice over';
const DECOY = 'the very same BYTES, twice over'; // same length, different content
const SHARED_TOO = 'a second pair, identical to each other and to nothing else';
const SHARED_THIRD = 'a third pair, which nobody finished choosing for'; 

/** Big enough that nothing else a worker's store holds comes near it — the template tops out at 11 KB. */
const BIG = `${DEMO}/media/intro.bin`;
const BIG_BYTES = 512 * 1024;

/** A second big file, for the delete: the one press has to reach more than one row. */
const BIG_TOO = `${DEMO}/media/outro.bin`;
const BIG_TOO_BYTES = 384 * 1024;

/** The document whose links must survive the consolidation. */
const NOTES = `${DEMO}/notes.md`;

const write = async (request: APIRequestContext, path: string, body: string | Buffer) => {
    const slash = path.lastIndexOf('/');
    const response = await request.post(`${workerApi()}/upload`, {
        multipart: {
            path: path.slice(0, slash),
            file: {
                name: path.slice(slash + 1),
                mimeType: 'application/octet-stream',
                buffer: typeof body === 'string' ? Buffer.from(body) : body,
            },
        },
    });
    expect(response.ok(), `writing ${path}`).toBeTruthy();
};

const createFolder = async (request: APIRequestContext, path: string) => {
    const response = await request.post(`${workerApi()}/createFolder?path=${encodeURIComponent(path)}`);
    expect(response.ok(), `creating ${path}`).toBeTruthy();
};

const exists = async (request: APIRequestContext, path: string): Promise<boolean> => {
    const response = await request.get(`${workerApi()}/info?path=${encodeURIComponent(path)}`);
    return response.ok() && (await response.json()) !== null;
};

const textOf = async (request: APIRequestContext, path: string): Promise<string> => {
    const response = await request.get(`${workerApi()}/getFile?path=${encodeURIComponent(path)}`);
    expect(response.ok(), `reading ${path}`).toBeTruthy();
    return response.text();
};

/**
 * Opens the view the way a user does: the "…" menu of the top banner.
 *
 * Scoped to the menu that is on screen, like the other menu-walking specs: antd leaves a popup it
 * is closing in the DOM for the length of its fade, and an unscoped locator finds that one.
 */
const openTheView = async (page: Page) => {
    await page.goto('');
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await page.locator('.cms-top-banner .anticon-more').click();
    await page.locator('.ant-dropdown-menu:visible').first()
        .getByText('File optimizations…', { exact: true }).click();
    await expect(page.getByTestId('file-optimizations-view')).toBeVisible({ timeout: TIMEOUT });
    // The scan walks the store and reads what it must read; the tab is not there until it answers.
    await expect(page.getByTestId('duplicates-tab')).toBeVisible({ timeout: TIMEOUT });
};

/** One of our groups — a worker's store may well hold other duplicates, and this spec owns three. */
const groupOf = (page: Page, name: string) =>
    page.getByTestId('duplicate-group').filter({ hasText: name });

/**
 * The tab's one button, over every group answered. Scoped to the tab because the confirmation's OK
 * bears the same words, and it is portalled out of it.
 */
const keepButton = (page: Page) =>
    page.getByTestId('duplicates-tab').getByRole('button', { name: 'Keep only one' });

/** Answers one group: the location from one of its rows, the name from the other. */
const answer = async (page: Page, name: string, folder: string, keptName: string) => {
    const group = groupOf(page, name);
    await group.getByLabel(`Keep the location ${folder}`).check();
    await group.getByLabel(`Keep the name ${keptName}`).check();
};

test.describe('file optimizations', () => {
    test.beforeEach(async ({ request }) => {
        await createFolder(request, `${DEMO}/assets`);
        await createFolder(request, `${DEMO}/scratch`);
        await createFolder(request, `${DEMO}/media`);
        await write(request, COPY_A, SHARED);
        await write(request, COPY_B, SHARED);
        await write(request, LOOKALIKE, DECOY);
        await write(request, SECOND_A, SHARED_TOO);
        await write(request, SECOND_B, SHARED_TOO);
        await write(request, UNTOUCHED_A, SHARED_THIRD);
        await write(request, UNTOUCHED_B, SHARED_THIRD);
        await write(request, BIG, Buffer.alloc(BIG_BYTES, 7));
        await write(request, NOTES, `the logo is ![](/${COPY_B}) and the other one is ![](/${COPY_A})\n`);
    });

    test.afterEach(async ({ request }) => {
        await request.delete(`${workerApi()}/delete?path=${encodeURIComponent(DEMO)}`);
        await resetViewState();
    });

    test('keeps one copy of every group answered, in one press, and repoints the links at it',
        async ({ page, request }) => {
            await openTheView(page);
            const group = groupOf(page, 'IMG_4471.png');
            await expect(group).toHaveCount(1, { timeout: TIMEOUT });

            // The decoy is the same length as the two copies and is not in the group: identity was
            // read, not measured.
            await expect(group).not.toContainText('decoy.png');
            await expect(page.getByTestId('duplicate-group').filter({ hasText: 'decoy.png' })).toHaveCount(0);

            // Nothing is chosen yet, so the destructive button is not available.
            const keep = keepButton(page);
            await expect(keep).toBeDisabled();

            // The location from one row, the name from the other — the case the two halves exist for.
            await group.getByLabel(`Keep the location ${DEMO}/assets`).check();
            await expect(keep).toBeDisabled();
            await group.getByLabel('Keep the name logo.png').check();
            await expect(keep).toBeEnabled();

            // What it would do, before it is done.
            await expect(group.getByTestId('keep-target')).toHaveText(`→ /${KEPT}`);

            // A second group answered, and a third left with only its location chosen. The button
            // counts the two it can act on and says so.
            await answer(page, 'IMG_9002.png', `${DEMO}/assets`, 'banner.png');
            await groupOf(page, 'shot-copy.png').getByLabel(`Keep the location ${DEMO}/media`).check();
            await expect(keep).toHaveText('Keep only one in 2 groups');

            await keep.click();
            // Scoped to the modal: the view itself is a panel on the central area's stack, which
            // is a second visible dialog.
            const confirmation = page.locator('.ant-modal');
            await expect(confirmation).toContainText(`/${COPY_A}`);
            await expect(confirmation).toContainText(`/${SECOND_KEPT}`);
            // What was not answered is not in what is about to run.
            await expect(confirmation).not.toContainText('shot');
            await confirmation.getByRole('button', { name: 'Keep only one', exact: true }).click();

            // One file per group answered, where it was asked for, and none of the paths they were
            // made of.
            await expect.poll(() => exists(request, KEPT), { timeout: TIMEOUT }).toBe(true);
            expect(await exists(request, COPY_A)).toBe(false);
            expect(await exists(request, COPY_B)).toBe(false);
            expect(await textOf(request, KEPT)).toBe(SHARED);
            expect(await exists(request, SECOND_KEPT)).toBe(true);
            expect(await exists(request, SECOND_A)).toBe(false);
            expect(await exists(request, SECOND_B)).toBe(false);
            expect(await textOf(request, SECOND_KEPT)).toBe(SHARED_TOO);

            // The half-answered group is untouched: both its copies are still there, which is the
            // guard that lets one button stand over groups nobody has finished choosing for.
            expect(await exists(request, UNTOUCHED_A)).toBe(true);
            expect(await exists(request, UNTOUCHED_B)).toBe(true);

            // And the document that pointed at both copies points at the survivor twice — the whole
            // reason a consolidation is a move rather than a delete.
            const notes = await textOf(request, NOTES);
            expect(notes).not.toContain(COPY_A);
            expect(notes).not.toContain(COPY_B);
            expect(notes.split(`/${KEPT}`).length - 1).toBe(2);

            // The groups it acted on are gone from the re-scan that followed, and the one it left
            // alone is still on offer.
            await expect(groupOf(page, 'IMG_4471.png')).toHaveCount(0, { timeout: TIMEOUT });
            await expect(groupOf(page, 'IMG_9002.png')).toHaveCount(0);
            await expect(groupOf(page, 'shot-copy.png')).toHaveCount(1);
        });

    test('lists the biggest files of the store, biggest first', async ({ page }) => {
        await openTheView(page);
        await page.getByRole('tab', { name: 'Big files' }).click();

        const table = page.getByTestId('big-files-tab');
        await expect(table).toBeVisible({ timeout: TIMEOUT });

        // Nothing else a worker's store holds is anywhere near half a megabyte, so ours heads the
        // list — which is the ordering claim, made against the one file whose size the spec chose.
        const ours = table.locator('tbody tr').filter({ hasText: 'intro.bin' });
        await expect(ours).toHaveCount(1);
        // The rank is the second cell: the first holds the row's tick.
        await expect(ours.locator('td').nth(1)).toHaveText('1');
        await expect(ours).toContainText('512 KB');
        await expect(ours).toContainText(`${DEMO}/media`);
    });

    test('deletes every big file ticked, in one press, and leaves the rest of the store alone',
        async ({ page, request }) => {
            await write(request, BIG_TOO, Buffer.alloc(BIG_TOO_BYTES, 9));
            await openTheView(page);
            await page.getByRole('tab', { name: 'Big files' }).click();

            const table = page.getByTestId('big-files-tab');
            await expect(table).toBeVisible({ timeout: TIMEOUT });
            // Scoped to the tab: the confirmation's OK bears the same words and is portalled out of it.
            const deleteAll = table.getByRole('button', { name: 'Delete all' });

            // Nothing is ticked for the reader, so the button reaches nothing yet.
            await expect(deleteAll).toBeDisabled();

            await table.getByLabel(`Select ${BIG}`).check();
            await table.getByLabel(`Select ${BIG_TOO}`).check();
            await expect(table.getByTestId('delete-summary')).toHaveText('2 files selected — 896 KB');

            await deleteAll.click();
            // Scoped to the modal: the view itself is a panel on the central area's stack, which
            // is a second visible dialog.
            const confirmation = page.locator('.ant-modal');
            await expect(confirmation).toContainText(`/${BIG}`);
            await expect(confirmation).toContainText(`/${BIG_TOO}`);
            await confirmation.getByRole('button', { name: 'Delete all', exact: true }).click();

            // Both gone from the disk, and from the list the re-scan answered with.
            await expect.poll(() => exists(request, BIG), { timeout: TIMEOUT }).toBe(false);
            expect(await exists(request, BIG_TOO)).toBe(false);
            await expect(table.locator('tbody tr').filter({ hasText: 'intro.bin' })).toHaveCount(0, { timeout: TIMEOUT });
            await expect(table.locator('tbody tr').filter({ hasText: 'outro.bin' })).toHaveCount(0);

            // Nothing that was not ticked went with them.
            expect(await exists(request, NOTES)).toBe(true);
            expect(await exists(request, COPY_A)).toBe(true);
        });
});
