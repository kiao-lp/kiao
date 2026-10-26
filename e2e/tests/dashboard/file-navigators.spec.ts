import { test, expect, Page, flushViewState, resetViewState } from '../harness';

/** E2E: file tree visibility and placement in the real layout. */

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

const TREE = '[data-testid="nav-tree"]';
const LEFT = '[data-testid="tool-bar-side-left"]';
const CENTER = '[data-testid="tool-bar-side-center"]';
const CENTER_BAR = '[data-testid="tool-bar-center"]';
const CENTER_STRIP = `${CENTER_BAR} > .ant-tabs > .ant-tabs-nav`;
const RIGHT = '[data-testid="tool-bar-side-right"]';
const LEFT_TOGGLE = '[data-testid="bar-toggle-left"]';

const open = async (page: Page) => {
    await page.goto('');
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
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

test.describe('the file tree', () => {
    // Which columns are open and which tab sits where is app-wide, so what this moves it moves back.
    test.afterEach(resetViewState);

    test('offers the file tree with the left column initially hidden and no Files panel', async ({ page }) => {
        await open(page);

        await expect(page.locator(TREE)).toHaveCount(0);
        await expect(page.locator(LEFT)).toHaveCount(0);
        await expect(page.locator(LEFT_TOGGLE)).toBeEnabled();

        await openLayoutGrid(page, TREE_TAB);
        await expect(page.getByTestId(`show-tab-${BAR_TAB}`)).toHaveCount(0);
        await expect(page.getByRole('menuitem', { name: 'Files', exact: true })).toHaveCount(0);
        await page.keyboard.press('Escape');
    });

    test('reveals the tree down the left column beside the document', async ({ page }) => {
        await open(page);
        await page.locator(LEFT_TOGGLE).click();

        await expect(page.locator(`${LEFT} ${TREE}`)).toBeVisible({ timeout: TIMEOUT });
        await expect(page.locator('.cms-document-area')).toBeVisible();
    });

    test('moves the tree to the other column', async ({ page }) => {
        await open(page);
        await page.locator(LEFT_TOGGLE).click();
        await expect(page.locator(`${LEFT} ${TREE}`)).toBeVisible({ timeout: TIMEOUT });

        await openLayoutGrid(page, TREE_TAB);
        await rectangle(page, TREE_TAB, 'right').click();
        await page.keyboard.press('Escape');

        await expect(page.locator(`${RIGHT} ${TREE}`)).toBeVisible({ timeout: TIMEOUT });
        await expect(page.locator(`${LEFT} ${TREE}`)).toHaveCount(0);
    });

    test('offers only the left, central and right areas in the Show menu', async ({ page }) => {
        await open(page);
        const grid = await openLayoutGrid(page, TREE_TAB);

        await expect(page.getByTestId('tool-bar-side-top')).toHaveCount(0);
        await expect(grid.getByRole('button')).toHaveCount(3);
        await expect(rectangle(page, TREE_TAB, 'top')).toHaveCount(0);
        await expect(rectangle(page, TREE_TAB, 'left')).toBeEnabled();
        await expect(rectangle(page, TREE_TAB, 'center')).toBeEnabled();
        await expect(rectangle(page, TREE_TAB, 'right')).toBeEnabled();
        await page.keyboard.press('Escape');
    });

    test('moves the tree to the centre beside the document', async ({ page }) => {
        await open(page);
        const tabs = page.locator(`${CENTER_STRIP} .ant-tabs-tab`);
        const initialTabCount = await tabs.count();

        await openLayoutGrid(page, TREE_TAB);
        await rectangle(page, TREE_TAB, 'center').click();
        await page.keyboard.press('Escape');

        // The document stays pinned and selected while the tree gains a tab alongside it.
        await expect(page.locator(`${CENTER} .cms-document-area`)).toBeVisible({ timeout: TIMEOUT });
        await expect(tabs).toHaveCount(initialTabCount + 1);

        // The tree mounts when it is first looked at.
        await expect(page.locator(TREE)).toHaveCount(0);
        await page.locator(`${CENTER_STRIP} .ant-tabs-tab [aria-label="File tree"]`).click();
        await expect(page.locator(`${CENTER} ${TREE}`)).toBeVisible({ timeout: TIMEOUT });

        // And the document comes back with one click.
        await page.locator(`${CENTER_STRIP} .ant-tabs-tab [aria-label="Document"]`).click();
        await expect(page.locator(`${CENTER} .cms-document-area`)).toBeVisible({ timeout: TIMEOUT });
    });

    test('moves an inactive tab from its right-click layout grid', async ({ page }) => {
        await open(page);
        await page.locator('.cms-top-banner .anticon-more').click();
        const show = page.getByText('Show', { exact: true });
        await expect(show).toBeVisible();
        await page.waitForTimeout(SETTLE_MS);
        await show.hover();
        const centralAreas = page.getByText('Central areas', { exact: true });
        await expect(centralAreas).toBeVisible();
        await page.waitForTimeout(SETTLE_MS);
        await centralAreas.hover();
        await page.getByTestId('show-central-count-3').click();
        await page.keyboard.press('Escape');

        await openLayoutGrid(page, TREE_TAB);
        await rectangle(page, TREE_TAB, 'center').click();
        await page.keyboard.press('Escape');

        const treeTab = page.locator(`${CENTER_STRIP} .ant-tabs-tab`).filter({
            has: page.getByRole('tab', { name: 'File tree', exact: true }),
        });
        await expect(treeTab).toBeVisible();
        await treeTab.click({ button: 'right', position: { x: 2, y: 2 } });

        const grid = page.locator('.ant-dropdown:visible').getByTestId(`layout-grid-${TREE_TAB}`);
        await expect(grid).toBeVisible();
        await expect(grid.getByRole('button')).toHaveCount(5);
        await expect(grid.getByTestId(`layout-cell-${TREE_TAB}-center`)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator(`${CENTER_BAR} .cms-document-area`)).toBeVisible();
        await expect(page.locator(TREE)).toHaveCount(0);

        await grid.getByTestId(`layout-cell-${TREE_TAB}-right`).click();
        await expect(grid).not.toBeVisible();
        await expect(page.locator(`${RIGHT} ${TREE}`)).toBeVisible();
        await expect(treeTab).toHaveCount(0);

        await flushViewState(page);
        await page.reload();
        await expect(page.locator(`${RIGHT} ${TREE}`)).toBeVisible({ timeout: TIMEOUT });
        await expect(page.locator(`${CENTER_BAR} .cms-document-area`)).toBeVisible();

        await page.locator(RIGHT).getByRole('tab', { name: 'File tree', exact: true }).click({ button: 'right' });
        await expect(grid).toBeVisible();
        await grid.getByTestId(`layout-cell-${TREE_TAB}-center-3`).click();
        await expect(page.getByTestId('tool-bar-center-3').locator(TREE)).toBeVisible();
    });

    test('hides a tab by right-clicking it and choosing its current area', async ({ page }) => {
        await open(page);
        await openLayoutGrid(page, TREE_TAB);
        await rectangle(page, TREE_TAB, 'center').click();
        await page.keyboard.press('Escape');

        const treeTab = page.locator(CENTER_STRIP).getByRole('tab', { name: 'File tree', exact: true });
        await treeTab.click();
        await expect(page.locator(`${CENTER} ${TREE}`)).toBeVisible();
        await treeTab.click({ button: 'right' });
        const grid = page.locator('.ant-dropdown:visible').getByTestId(`layout-grid-${TREE_TAB}`);
        await expect(grid).toBeVisible();
        await expect(grid.getByRole('button')).toHaveCount(3);
        await grid.getByTestId(`layout-cell-${TREE_TAB}-center`).click();

        await expect(treeTab).toHaveCount(0);
        await expect(grid).not.toBeVisible();
        await expect(page.locator(TREE)).toHaveCount(0);
        await expect(page.locator(`${CENTER} .cms-document-area`)).toBeVisible();
    });

    test('keeps the pinned document out of the tab placement menu', async ({ page }) => {
        await open(page);
        await page.locator(CENTER_STRIP).getByRole('tab', { name: 'Document', exact: true })
            .click({ button: 'right' });

        await expect(page.getByTestId('layout-grid-document')).toHaveCount(0);
        await expect(page.locator(`${CENTER} .cms-document-area`)).toBeVisible();
    });

    test('hides the tree from its current bar while keeping the document visible', async ({ page }) => {
        await open(page);
        await page.locator(LEFT_TOGGLE).click();
        await expect(page.locator(`${LEFT} ${TREE}`)).toBeVisible({ timeout: TIMEOUT });

        await openLayoutGrid(page, TREE_TAB);
        await rectangle(page, TREE_TAB, 'left').click();
        await page.keyboard.press('Escape');

        await expect(page.locator(TREE)).toHaveCount(0, { timeout: TIMEOUT });
        await expect(page.locator('.cms-document-area')).toBeVisible();
    });
});
