import { test, expect, workerApi, Locator, Page, resetViewState } from '../../harness';

/**
 * E2E: a template variable typed `file`, answered by dragging a file out of the navigation tree.
 *
 * The whole point of the type is that the two ends belong to different halves of the app — the
 * tree writes the drag (`writeDraggedFiles`), the instantiation panel reads it back (`useFileDrop`)
 * — so what is worth asserting here is that they agree, and that what the drop leaves in the heap
 * comes out of the template: the path in one expression, the file's name in another.
 *
 * The drag is dispatched rather than mimed with the pointer. A pointer drag would be testing
 * Chromium's drag machinery; what these two need to agree on is the `DataTransfer`, so the tree is
 * asked to fill one and the box is handed it — the same two events the browser would have
 * delivered, and no timing to lose.
 */

const TIMEOUT = 15000;

const TEMPLATE_PATH = 'templates/Document.temp.md';
/** A file at the store root: the tree shows it with only the root branch open. */
const DROPPED = 'welcome.md';

const SELECTORS = {
    STATUS_BAR: '.cms-top-banner',
};

/**
 * The arrangement this spec needs: the navigation tree down the left column with the store root
 * open, so the dropped file's row is on screen.
 *
 * Seeded rather than clicked. The arrangement is a document, and writing it is exact.
 */
const seedState = async () => {
    const response = await fetch(`${workerApi()}/config/dashboard-view-state.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            version: 1,
            global: {
                toolBars: {
                    placement: { 'file-navigation-tree': 'left', 'file-navigation-bar': 'off' },
                    off: [],
                    width: { left: 260 },
                },
                navTree: { expanded: [''] },
            },
            folders: {},
            files: {},
        }),
    });
    expect(response.ok, 'seeding the view state').toBeTruthy();
};

/**
 * Drags `path`'s row out of the tree and drops it on `target`.
 *
 * The row is the draggable element, not the label inside it that carries the test id — a drag
 * starts on the whole row, the icon and the name included.
 */
const dragFromTree = async (page: Page, path: string, target: Locator) => {
    const row = page.locator(`.cms-nav-tree-row:has([data-testid="nav-item-${path}"])`);
    await expect(row).toBeVisible({ timeout: TIMEOUT });

    await row.evaluate((source, box) => {
        const data = new DataTransfer();
        source.dispatchEvent(new DragEvent('dragstart', { dataTransfer: data, bubbles: true }));
        for (const type of ['dragover', 'drop']) {
            box.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
        }
    }, await target.elementHandle());
};

test.describe('a template variable typed file', () => {
    // The arrangement is app-wide: what this spec moves, it moves for everything after it.
    test.afterEach(async () => { await resetViewState(); });

    test('is filled by dropping a file out of the navigation tree', async ({ page }) => {
        await seedState();
        await page.goto(TEMPLATE_PATH);
        await expect(page.locator(SELECTORS.STATUS_BAR)).toBeVisible({ timeout: TIMEOUT });

        const field = page.getByTestId('template-file-doc');
        await expect(field).toBeVisible({ timeout: TIMEOUT });
        await expect(field).toHaveValue('');

        await dragFromTree(page, DROPPED, field);

        // The path as a document of the store names it: from the root, with a leading slash.
        await expect(field).toHaveValue(`/${DROPPED}`);

        // And the same drop answers the second expression, which asked only for the name.
        // Contained rather than exact: the preview carries a copy-HTML button of its own.
        await expect(page.getByTestId('template-preview'))
            .toContainText(`Read /${DROPPED} — it is called ${DROPPED}.`, { timeout: TIMEOUT });
    });
});
