import { test, expect, APIRequestContext, Page, workerApi, flushViewState } from '../harness';

/**
 * E2E: the documents kept at hand, as a tool bar panel over one JSON file.
 *
 * The format and the index arithmetic are unit-tested; what only the running app can show is that
 * the star answers for the document the browser is actually on, that what it does lands in
 * `kiao-user-config/bookmarks.json` as a `{ title, link, note }` entry, that the row it adds is a
 * link back to that document, and that the note opens under it rendered as markdown.
 */

const TIMEOUT = 15000;
const BOOKMARKS = 'kiao-user-config/bookmarks.json';

const SELECTORS = {
    RIGHT_TOGGLE: '[data-testid="bar-toggle-right"]',
    RIGHT_COLUMN: '[data-testid="tool-bar-side-right"]',
    TAB: '[data-testid="tool-bar-right"] .ant-tabs-tab',
};

interface BookmarkEntry {
    title: string;
    link: string;
    note: string;
}

/** What the panel writes: the entries, pretty-printed, with the trailing newline. */
const jsonOf = (entries: BookmarkEntry[]): string => `${JSON.stringify(entries, null, 2)}\n`;

const read = async (path: string): Promise<string> => {
    const response = await fetch(`${workerApi()}/getFile?path=${encodeURIComponent(path)}`);
    return response.ok ? response.text() : '';
};

const remove = async (path: string) => {
    await fetch(`${workerApi()}/delete?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
};

/** A document of this spec's own, so that renaming one disturbs nothing another spec starts from. */
const write = async (request: APIRequestContext, path: string, content: string) => {
    const response = await request.fetch(`${workerApi()}/update?path=${encodeURIComponent(path)}`, {
        method: 'PUT',
        multipart: {
            file: {
                name: path.split('/').pop()!,
                mimeType: 'application/octet-stream',
                buffer: Buffer.from(content),
            },
        },
    });
    expect(response.ok(), `writing ${path}`).toBeTruthy();
};

/** The rename the file browser makes, which is what runs the link fixer over the store. */
const rename = async (from: string, to: string) => {
    const query = new URLSearchParams({ path: from, newPath: to });
    const response = await fetch(`${workerApi()}/rename?${query}`, { method: 'POST' });
    expect(response.ok, `renaming ${from} to ${to}`).toBeTruthy();
};

const open = async (page: Page, path: string) => {
    await page.goto(path);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
};

/**
 * Puts the bookmarks tab in the right column, through the Show menu — which is the only way a
 * panel is put anywhere, and therefore part of what this asserts.
 *
 * Three menus deep, each opening on a motion of its own, so every step waits for the next to have
 * arrived *and* stopped moving before it is aimed at; a whole opening is retried rather than left
 * to fail, an antd sub-menu being free to close again when the pointer arrives early.
 */
const placeInRightColumn = async (page: Page) => {
    const cell = page.getByTestId('layout-cell-bookmarks-right');
    for (let attempt = 1; ; attempt += 1) {
        await page.keyboard.press('Escape');
        await page.locator('.cms-top-banner .anticon-more').click();
        const show = page.getByText('Show', { exact: true });
        await expect(show).toBeVisible({ timeout: TIMEOUT });
        await page.waitForTimeout(300);
        await show.hover();

        const tab = page.getByTestId('show-tab-bookmarks');
        await expect(tab).toBeVisible({ timeout: TIMEOUT });
        await page.waitForTimeout(300);
        await tab.hover();

        // The grid opens on a motion of its own like the two menus above it, so it is waited for
        // rather than read in the same breath as the hover that asks for it: antd holds a sub-menu
        // back by `subMenuOpenDelay`, and looking the instant the pointer lands finds it absent
        // every time, however healthy the app.
        if (await cell.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false)) break;
        expect(attempt, 'the Show menu never opened on the bookmarks tab').toBeLessThan(3);
    }
    await page.waitForTimeout(300);
    await cell.click();
    await page.keyboard.press('Escape');
};

/**
 * Whether the right column is on. Its absence says nothing on its own — a column holding no tab is
 * not drawn either — so the state is read off the button that switches it, which says which of the
 * two clicking it would do.
 */
const rightColumnOn = async (page: Page): Promise<boolean> =>
    (await page.locator(SELECTORS.RIGHT_TOGGLE).getAttribute('aria-label')) === 'Hide the right column';

/** The panel, on screen: its tab in the right column, that column on, and that tab the one shown. */
const showBookmarks = async (page: Page) => {
    // Where a tab sits and whether its side is on are two different things, and the column starts
    // off — so it goes on first, and what it holds can then be seen.
    if (!await rightColumnOn(page)) await page.locator(SELECTORS.RIGHT_TOGGLE).click();

    // The placement is remembered app-wide, so the menu is walked once a run rather than once a test.
    const tab = page.locator(`${SELECTORS.TAB} [aria-label="Bookmarks"]`);
    if (await tab.count() === 0 && await page.getByTestId('bookmarks-panel').count() === 0) {
        await placeInRightColumn(page);
        if (!await rightColumnOn(page)) await page.locator(SELECTORS.RIGHT_TOGGLE).click();
    }
    // A bar holding several tabs shows the strip that chooses between them, and a tab just moved
    // in is not the one it is showing.
    if (await tab.count() > 0) await tab.click();
    // The pointer left on the tab keeps its tooltip open, over the panel underneath.
    await page.mouse.move(0, 0);

    await expect(page.getByTestId('bookmarks-panel')).toBeVisible({ timeout: TIMEOUT });
};

/**
 * Puts the right column back the way the application starts it: off, on its first tab.
 *
 * Its open state and its active tab live together in the shared view-state document, so a panel
 * left open here would leave every following spec looking at it.
 */
const resetRightColumn = async (page: Page) => {
    if (!await rightColumnOn(page)) return;

    await page.locator(SELECTORS.TAB).first().click();
    await page.locator(SELECTORS.RIGHT_TOGGLE).click();
    await expect(page.locator(SELECTORS.RIGHT_COLUMN)).toHaveCount(0);
    await flushViewState(page);
};

test.describe('bookmarks', () => {
    // The store this runs against is a fresh copy of the fixtures, but the specs of a run share
    // it: each of these starts from a store that bookmarks nothing.
    test.beforeEach(async () => { await remove(BOOKMARKS); });

    // In a hook rather than at the end of the test, so a failure halfway through cannot leave the
    // column on the bookmarks panel for everything that runs after it.
    test.afterEach(async ({ page }) => { await resetRightColumn(page); });

    test('the star bookmarks the open document, and takes it back out', async ({ page }) => {
        await open(page, 'welcome.md');
        await showBookmarks(page);

        const panel = page.getByTestId('bookmarks-panel');
        const star = panel.getByTestId('toggle-bookmark');
        await expect(star).toHaveText('Bookmark this document');

        await star.click();
        // The row is a link back to the document it was made from.
        await expect(panel.getByTestId('bookmark')).toHaveCount(1);
        await expect(panel.getByRole('link', { name: 'welcome.md' })).toHaveAttribute(
            'href', '/dashboard/welcome.md',
        );
        // …and the star now says the document is one of them.
        await expect(star).toHaveText('Unbookmark this document');

        await expect.poll(() => read(BOOKMARKS), { timeout: TIMEOUT })
            .toBe(jsonOf([{ title: 'welcome.md', link: '/welcome.md', note: '' }]));

        await star.click();
        // The file's own margin rather than the default: under a full run the unbookmark
        // round-trip lands later than a quiet shard answers it.
        await expect(panel.getByTestId('bookmark')).toHaveCount(0, { timeout: TIMEOUT });
        await expect(star).toHaveText('Bookmark this document');

        await expect.poll(() => read(BOOKMARKS), { timeout: TIMEOUT }).toBe('[]\n');
    });

    test('the note is written in its own box, and opens rendered as markdown', async ({ page }) => {
        await open(page, 'welcome.md');
        await showBookmarks(page);

        const panel = page.getByTestId('bookmarks-panel');
        await panel.getByTestId('toggle-bookmark').click();

        // A bookmark just made opens its form: the note is what is wanted next.
        const row = panel.getByTestId('bookmark');
        await expect(row.getByTestId('bookmark-title')).toHaveValue('welcome.md');
        await row.getByTestId('bookmark-note').fill('where the store *starts*.');

        await expect.poll(() => read(BOOKMARKS), { timeout: TIMEOUT })
            .toBe(jsonOf([{ title: 'welcome.md', link: '/welcome.md', note: 'where the store *starts*.' }]));

        // Done with the form, the row shows the note rendered — and the caret closes it again.
        // The emphasis holds `starts` alone: in `*starts*.` the closing star comes before the
        // full stop, so markdown leaves the stop outside the `em`.
        await row.getByTestId('done-editing').click();
        await expect(row.locator('em')).toHaveText('starts');

        await row.getByTestId('toggle-note').click();
        await expect(row.locator('em')).toHaveCount(0);

        await row.getByTestId('toggle-note').click();
        await expect(row.locator('em')).toHaveText('starts');
    });

    test('a bookmark leads back to its document, and the star follows the browser', async ({ page }) => {
        await open(page, 'welcome.md');
        await showBookmarks(page);

        const panel = page.getByTestId('bookmarks-panel');
        await panel.getByTestId('toggle-bookmark').click();
        await expect(panel.getByTestId('toggle-bookmark')).toHaveText('Unbookmark this document');
        // The list is the file: a page load reads it back, and the write has to have landed first.
        await expect.poll(() => read(BOOKMARKS), { timeout: TIMEOUT }).toContain('welcome.md');

        // The bookmark stays in the list wherever the browser goes; the star is about the document
        // under it, and that one is not bookmarked. (The panel is asked for again: which column is
        // on and which tab it shows is remembered on a debounce of its own, and view-state.spec is
        // where that promise is kept.)
        await open(page, 'smoke/disk-follow.md');
        await showBookmarks(page);
        await expect(panel.getByTestId('bookmark')).toHaveCount(1);
        await expect(panel.getByTestId('toggle-bookmark')).toHaveText('Bookmark this document');

        // Clicking it goes back, without reloading the app: a bookmark is an internal link like any
        // other, and the page it is rendered on is the one that answers for it.
        await page.evaluate(() => { (window as any).__stillTheSamePage = true; });
        await panel.getByRole('link', { name: 'welcome.md' }).click();

        await expect(panel.getByTestId('toggle-bookmark')).toHaveText('Unbookmark this document');
        expect(page.url()).toContain('/dashboard/welcome.md');
        expect(await page.evaluate(() => (window as any).__stillTheSamePage)).toBe(true);
    });

    /**
     * The link in a bookmark is written by one program and repaired by another, and the two have to
     * agree on the spelling. Dashboard writes the percent-encoded form — a document called
     * `Bilan (2026) & suite.md` is bookmarked as `/smoke/Bilan%20%282026%29%20%26%20suite.md` —
     * and the fixer matches either form when its document moves. What it writes back into the JSON
     * is the path as it reads: a JSON string ends at its quote, so unlike a markdown destination
     * it takes the spaces and the parentheses raw.
     */
    test('a bookmark follows its document through a rename that has to be escaped', async ({ page, request }) => {
        const plain = 'smoke/link-encoding.md';
        const escaped = 'smoke/Bilan (2026) & suite.md';

        await remove(escaped);
        await write(request, plain, 'A document worth keeping at hand.\n');

        await open(page, plain);
        await showBookmarks(page);
        await page.getByTestId('bookmarks-panel').getByTestId('toggle-bookmark').click();
        await expect.poll(() => read(BOOKMARKS), { timeout: TIMEOUT })
            .toBe(jsonOf([{ title: 'link-encoding.md', link: `/${plain}`, note: '' }]));

        await rename(plain, escaped);
        await expect.poll(() => read(BOOKMARKS), { timeout: TIMEOUT })
            .toBe(jsonOf([{ title: 'link-encoding.md', link: `/${escaped}`, note: '' }]));

        await rename(escaped, plain);
        await expect.poll(() => read(BOOKMARKS), { timeout: TIMEOUT })
            .toBe(jsonOf([{ title: 'link-encoding.md', link: `/${plain}`, note: '' }]));

        await remove(plain);
    });
});
