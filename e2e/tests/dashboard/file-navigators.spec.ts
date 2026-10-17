import { test, expect, Page, resetViewState } from '../harness';

/**
 * E2E: the two file navigators, placed and shown independently.
 *
 * Browsing the store used to be **one** tool bar tab that asked the bar it was in which way to lay
 * itself out — a line of the open folder's entries across the top, a tree of the whole store down a
 * column. A tab is in one bar at a time, so the two were exclusive: putting the tree in a column
 * took the line off the top. They are the same subject but not the same tool, and wanting both at
 * once is ordinary, so they are two tabs now.
 *
 * What that has to produce is asserted against the real app rather than the components, because
 * all of it is layout: two bars drawn at once, on two edges of the window, with the document still
 * between them. And because the rule that keeps each of them where it belongs — the line is
 * horizontal, the tree is vertical — is only worth anything if the Show menu really refuses the
 * rectangles it forbids.
 */

const TIMEOUT = 15000;

/** Each menu opens on a motion of its own, and nothing is aimed at until it has stopped moving. */
const SETTLE_MS = 300;

/**
 * How long a sub-menu is given to arrive before the whole opening is tried again. Comfortably more
 * than antd's own opening delay, and short enough that three lost attempts still fit in the budget
 * of one test — a menu that is coming is there within a fraction of this, and one that closed
 * behind the pointer is never coming at all.
 */
const OPEN_TIMEOUT = 2000;

const BAR_TAB = 'file-navigation-bar';
const TREE_TAB = 'file-navigation-tree';

/** The line, scoped to the top bar: both navigators label their rows `nav-item-<path>`. */
const LINE = '.cms-tool-bar-side-top .cms-nav-menu';
const TREE = '[data-testid="nav-tree"]';
const LEFT = '[data-testid="tool-bar-side-left"]';
const CENTER = '[data-testid="tool-bar-side-center"]';
const CENTER_BAR = '[data-testid="tool-bar-center"]';
const RIGHT = '[data-testid="tool-bar-side-right"]';
const LEFT_TOGGLE = '[data-testid="bar-toggle-left"]';

const open = async (page: Page) => {
    await page.goto('');
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator(LINE)).toBeVisible({ timeout: TIMEOUT });
};

/**
 * Opens the tools menu on one tab's layout grid and answers with it.
 *
 * Three menus deep, each arriving on a motion of its own, so every step waits for the next to be
 * there *and* still before it is aimed at — the pattern the other menu-walking specs use. A whole
 * opening is retried rather than left to fail, an antd sub-menu being free to close again when the
 * pointer arrives early.
 */
const openLayoutGrid = async (page: Page, tabId: string) => {
    const grid = page.getByTestId(`layout-grid-${tabId}`);
    for (let attempt = 1; ; attempt += 1) {
        await page.keyboard.press('Escape');
        await page.locator('.cms-top-banner .anticon-more').click();
        const show = page.getByText('Show', { exact: true });
        await expect(show).toBeVisible({ timeout: TIMEOUT });
        await page.waitForTimeout(SETTLE_MS);
        await show.hover();

        const tab = page.getByTestId(`show-tab-${tabId}`);
        await expect(tab).toBeVisible({ timeout: TIMEOUT });
        await page.waitForTimeout(SETTLE_MS);
        await tab.hover();

        // The grid opens on a motion of its own like the two menus above it, so it is waited for
        // rather than read in the same breath as the hover that asks for it: antd holds a sub-menu
        // back by `subMenuOpenDelay`, and looking the instant the pointer lands finds it absent
        // every time, however healthy the app. A bounded wait is what tells "not yet" — retry —
        // from "closed behind the pointer" — try the whole opening again.
        if (await grid.waitFor({ state: 'visible', timeout: OPEN_TIMEOUT }).then(() => true, () => false)) break;
        expect(attempt, `the Show menu never opened on ${tabId}`).toBeLessThan(3);
    }
    await page.waitForTimeout(SETTLE_MS);
    return grid;
};

const rectangle = (page: Page, tabId: string, bar: string) =>
    page.getByTestId(`layout-cell-${tabId}-${bar}`);

test.describe('the file navigators', () => {
    // Which columns are open and which tab sits where is app-wide, so what this moves it moves back.
    test.afterEach(resetViewState);

    test('opens on the line across the top, with the tree waiting in a column that is shut', async ({ page }) => {
        await open(page);

        // The app has always opened this way, and the split does not change it: the tree ships in
        // the left column and the left column ships off.
        await expect(page.locator(LINE)).toBeVisible();
        await expect(page.locator(TREE)).toHaveCount(0);
        await expect(page.locator(LEFT)).toHaveCount(0);

        // Which makes the banner's left switch what the tree is brought up with — no longer the
        // dead button of a column nothing is placed in.
        await expect(page.locator(LEFT_TOGGLE)).toBeEnabled();
    });

    test('draws both at once: the line across the top and the tree down the left column', async ({ page }) => {
        await open(page);

        await page.locator(LEFT_TOGGLE).click();

        // The whole point of the split. Both on screen, each in its own bar, with the document
        // still between them.
        await expect(page.locator(LINE)).toBeVisible({ timeout: TIMEOUT });
        await expect(page.locator(`${LEFT} ${TREE}`)).toBeVisible({ timeout: TIMEOUT });
        await expect(page.locator('.cms-document-area')).toBeVisible();
    });

    test('moves the tree to the other column and leaves the line where it is', async ({ page }) => {
        await open(page);
        await page.locator(LEFT_TOGGLE).click();
        await expect(page.locator(`${LEFT} ${TREE}`)).toBeVisible({ timeout: TIMEOUT });

        await openLayoutGrid(page, TREE_TAB);
        await rectangle(page, TREE_TAB, 'right').click();
        await page.keyboard.press('Escape');

        // Choosing a rectangle is asking to see the panel there, so the right column — which ships
        // off — comes on with the move.
        await expect(page.locator(`${RIGHT} ${TREE}`)).toBeVisible({ timeout: TIMEOUT });
        await expect(page.locator(`${LEFT} ${TREE}`)).toHaveCount(0);
        await expect(page.locator(LINE)).toBeVisible();
    });

    test('offers each of them only the bars it can be drawn in', async ({ page }) => {
        await open(page);

        // A tree laid across the top would be a tree one row tall; a line down a column would be
        // one entry wide. The rectangles are drawn all the same — the picture has to stay the
        // picture of the app — and refuse the click.
        await openLayoutGrid(page, TREE_TAB);
        await expect(rectangle(page, TREE_TAB, 'top')).toBeDisabled();
        await expect(rectangle(page, TREE_TAB, 'left')).toBeEnabled();
        await expect(rectangle(page, TREE_TAB, 'center')).toBeEnabled();
        await expect(rectangle(page, TREE_TAB, 'right')).toBeEnabled();

        await openLayoutGrid(page, BAR_TAB);
        await expect(rectangle(page, BAR_TAB, 'top')).toBeEnabled();
        await expect(rectangle(page, BAR_TAB, 'left')).toBeDisabled();
        await expect(rectangle(page, BAR_TAB, 'center')).toBeDisabled();
        await expect(rectangle(page, BAR_TAB, 'right')).toBeDisabled();
        await page.keyboard.press('Escape');
    });

    test('moves the tree to the centre beside the document', async ({ page }) => {
        await open(page);

        await openLayoutGrid(page, TREE_TAB);
        await rectangle(page, TREE_TAB, 'center').click();
        await page.keyboard.press('Escape');

        // The document stays where it is pinned, now with a strip: a tab of its own beside the
        // tree, and showing — a document that never chose in the centre opens on the document.
        await expect(page.locator(`${CENTER} .cms-document-area`)).toBeVisible({ timeout: TIMEOUT });
        await expect(page.locator(`${CENTER_BAR} .ant-tabs-tab`)).toHaveCount(2);

        // The tree mounts when it is first looked at.
        await expect(page.locator(TREE)).toHaveCount(0);
        await page.locator(`${CENTER_BAR} .ant-tabs-tab [aria-label="File tree"]`).click();
        await expect(page.locator(`${CENTER} ${TREE}`)).toBeVisible({ timeout: TIMEOUT });

        // And the document comes back with one click.
        await page.locator(`${CENTER_BAR} .ant-tabs-tab [aria-label="Document"]`).click();
        await expect(page.locator(`${CENTER} .cms-document-area`)).toBeVisible({ timeout: TIMEOUT });
    });

    test('takes the line off the top on its own, leaving the tree', async ({ page }) => {
        await open(page);
        await page.locator(LEFT_TOGGLE).click();
        await expect(page.locator(`${LEFT} ${TREE}`)).toBeVisible({ timeout: TIMEOUT });

        // The rectangle a tab is in is the one that dismisses it.
        await openLayoutGrid(page, BAR_TAB);
        await rectangle(page, BAR_TAB, 'top').click();
        await page.keyboard.press('Escape');

        await expect(page.locator(LINE)).toHaveCount(0, { timeout: TIMEOUT });
        await expect(page.locator(`${LEFT} ${TREE}`)).toBeVisible();
    });
});
