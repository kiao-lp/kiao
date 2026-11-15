import { test, expect, APIRequestContext, Locator, Page, workerApi, flushViewState, resetViewState, restoreFixture } from '../../harness';

/**
 * E2E: a file dragged out of the file navigator and let go over a map.
 *
 * The two ends of it belong to different halves of the app — the tree writes the drag
 * (`writeDraggedFiles`), the map reads it back (`useDroppedFiles`) — so what is worth proving here
 * is that they agree, and that where the file is let go is what decides what it becomes: a note of
 * its own over the bare map, a line at the end of the note it is let go on. What the link itself
 * looks like is `dragPaths.test`'s subject, and the rule for appending it `useDroppedFiles.spec`'s.
 *
 * The drag is dispatched rather than mimed with the pointer. A pointer drag would be testing
 * Chromium's drag machinery; what these two need to agree on is the `DataTransfer`, so the tree is
 * asked to fill one and the map is handed it — the same two events the browser would have
 * delivered, and no timing to lose. The drop carries the point it landed at, because on a map that
 * is the whole of where the note goes.
 */

const TIMEOUT = 15000;

const MAP = 'folder-a/Mindmap.mmap.json';
/** A file at the store root: the tree shows it with only the root branch open. */
const DROPPED = 'welcome.md';
/** What the drop writes — the file's name as the text, its store path as the destination. */
const LINK = `[${DROPPED}](/${DROPPED})`;

const NOTE_A = '# Note A\n\n---\n\nText';
const NOTE_B = '# Note B\n\n---\n\nOther text';

/** The specs of this map all write it, and a worker runs them one after another in one store. */
test.beforeEach(async ({ request }) => { await restoreFixture(request, MAP); });

// The arrangement is app-wide: what this spec moves, it moves for everything after it. The tab's
// own pending write is let land first, or it would come down on top of the undo.
test.afterEach(async ({ page }) => {
    await flushViewState(page);
    await resetViewState();
});

/**
 * The navigation tree down the left column with the store root open — the half of the app the drag
 * starts in. Seeded rather than clicked: the arrangement is a document, and writing it is exact.
 */
const seedState = async () => {
    const response = await fetch(`${workerApi()}/config/dashboard-view-state.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            version: 1,
            global: {
                toolBars: {
                    placement: { 'file-navigation-tree': 'left' },
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

/** What each note of the saved map says, in the order the map holds them. */
const contentsIn = async (request: APIRequestContext): Promise<string[]> => {
    const response = await request.get(`${workerApi()}/getFile?path=${encodeURIComponent(MAP)}`);
    return JSON.parse(await response.text()).content.elements.notes.map((note: any) => note.content);
};

/** Opens the map and puts it into EDIT, which is a click where there is no element. */
const openForEditing = async (page: Page): Promise<Locator> => {
    await page.goto(MAP);
    const mindmap = page.locator('.mindmap');
    await expect(mindmap).toBeVisible({ timeout: TIMEOUT });
    await mindmap.click({ position: { x: 20, y: 20 } });
    await expect(mindmap).toHaveClass(/mindmap-edit/, { timeout: TIMEOUT });
    return mindmap;
};

/**
 * Drags `path`'s row out of the tree and drops it on `target`, at `at` in the target's own
 * coordinates or over its middle.
 *
 * The row is the draggable element, not the label inside it that carries the test id — a drag
 * starts on the whole row, the icon and the name included.
 */
const dragFromTree = async (page: Page, path: string, target: Locator, at?: { x: number, y: number }) => {
    const row = page.locator(`.cms-nav-tree-row:has([data-testid="nav-item-${path}"])`);
    await expect(row).toBeVisible({ timeout: TIMEOUT });

    const box = (await target.boundingBox())!;
    const point = {
        clientX: box.x + (at ? at.x : box.width / 2),
        clientY: box.y + (at ? at.y : box.height / 2),
    };

    await row.evaluate((source, { element, point }) => {
        const data = new DataTransfer();
        source.dispatchEvent(new DragEvent('dragstart', { dataTransfer: data, bubbles: true }));
        for (const type of ['dragover', 'drop']) {
            element.dispatchEvent(new DragEvent(type, {
                dataTransfer: data, bubbles: true, cancelable: true, ...point,
            }));
        }
    }, { element: (await target.elementHandle())!, point });
};

test('mindmap: a file let go on the bare map leaves a note holding a link to it', async ({ page, request }) => {
    await seedState();
    const mindmap = await openForEditing(page);

    // Clear of both notes of the fixture, which sit up and to the left.
    await dragFromTree(page, DROPPED, mindmap, { x: 520, y: 160 });

    // The new note opens for editing the moment it has been measured and centred, as one made any
    // other way does. It already says what it is for; Ctrl+Enter is done with it.
    const popup = page.locator('.mindmap-rich-text-editor-wrapper');
    await expect(popup).toBeVisible({ timeout: TIMEOUT });
    await expect(popup.locator('textarea')).toHaveValue(LINK);
    await page.keyboard.press('Control+Enter');
    await expect(popup).not.toBeVisible();

    // Drawn on the map as the link it is, and openable from there.
    await expect(mindmap.getByRole('link', { name: DROPPED })).toBeVisible({ timeout: TIMEOUT });

    // And in the file: a third note, the two the map started with untouched.
    await expect.poll(() => contentsIn(request), { timeout: TIMEOUT }).toEqual([NOTE_A, NOTE_B, LINK]);
});

test('mindmap: a file let go on a note goes at the end of what that note says', async ({ page, request }) => {
    await seedState();
    const mindmap = await openForEditing(page);

    const noteA = mindmap.locator('.mindmap-rect').filter({ hasText: 'Note A' });
    await dragFromTree(page, DROPPED, noteA);

    // The link is in that note — and the map has made no note of it as well.
    await expect(noteA.getByRole('link', { name: DROPPED })).toBeVisible({ timeout: TIMEOUT });
    await expect(mindmap.locator('.mindmap-rect')).toHaveCount(2);

    await expect.poll(() => contentsIn(request), { timeout: TIMEOUT })
        .toEqual([`${NOTE_A}\n\n${LINK}`, NOTE_B]);
});
