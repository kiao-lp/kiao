import { test, expect, Page, workerApi, resetViewState } from '../harness';

/**
 * E2E: the navigation tree and the file browser show the store as it is.
 *
 * Every file operation is offered on every row of the tree — its context menu carries the same
 * New, Rename and Delete the browser's does — so the folder a rename, a deletion or a creation
 * lands in is as likely as not to be one the browser is not on. Re-reading the browsed folder
 * says nothing about that folder, and the tree keeps a listing for as long as its branch is
 * open: what is asserted here is that the row appears, changes name and goes, in a branch the
 * browser is nowhere near, without anything being reopened or reloaded by hand.
 *
 * The browsed folder is checked at the same time, and for the same reason: acting on another
 * folder from the tree must leave the document area exactly where it was.
 */

const TIMEOUT = 15000;
const STATE_DOC = 'dashboard-view-state.json';

const TREE = '[data-testid="nav-tree"]';

/** The browsed folder, and the branch acted on — two different folders, which is the point. */
const BROWSED = 'folder-a';
const OTHER = 'search';

/**
 * The navigation down the left column, with the two folders open, seeded into the view state rather
 * than clicked: what is under test is what the tree does once a file operation lands in one of them.
 */
const seedState = async () => {
    const response = await fetch(`${workerApi()}/config/${STATE_DOC}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            version: 1,
            global: {
                // Unarranged documents inherit this tree placement.
                toolBars: { placement: { 'file-navigation-tree': 'left' }, off: ['right'], width: { left: 260 } },
                navTree: { expanded: ['', BROWSED, OTHER] },
            },
            folders: {},
            files: {},
        }),
    });
    expect(response.ok).toBeTruthy();
};

const treeRow = (page: Page, path: string) => page.getByTestId(`nav-item-${path}`);

/** Opens the context menu of a tree row and clicks one of its entries. */
const rowMenu = async (page: Page, path: string, entry: string) => {
    await treeRow(page, path).click({ button: 'right' });
    const item = page.locator('.ant-dropdown:not(.ant-dropdown-hidden)').getByText(entry, { exact: true });
    await expect(item).toBeVisible({ timeout: TIMEOUT });
    await item.click();
};

test.describe('navigation tree refresh', () => {
    // `seedState` writes the app-wide half of the view state, and the left column it opens is
    // one every spec that follows on this Playwright worker would be laid out around. In a hook rather than
    // at the end of each test, so a failure halfway through leaves it no more open than a pass.
    test.afterEach(resetViewState);

    test('follows a creation, a rename and a deletion in a folder the browser is not on', async ({ page }) => {
        await seedState();
        await page.goto(BROWSED);
        await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
        await expect(page.locator(TREE)).toBeVisible({ timeout: TIMEOUT });
        // The other branch is open and read: what it holds has a row before anything happens.
        await expect(treeRow(page, `${OTHER}/alpha-only.md`)).toBeVisible({ timeout: TIMEOUT });

        // Created from the other branch's own context menu, so it lands in `search` while the
        // browser is on `folder-a` — the case the browsed folder's listing cannot report.
        await treeRow(page, OTHER).click({ button: 'right' });
        await page.locator('.ant-dropdown:not(.ant-dropdown-hidden)').getByText('New', { exact: true }).hover();
        await page.locator('.ant-dropdown-menu-submenu-popup').getByText('Markdown', { exact: true }).click();

        const renameInput = page.getByTestId('rename-input');
        await expect(renameInput).toBeVisible({ timeout: TIMEOUT });
        await expect(treeRow(page, `${OTHER}/New Markdown.md`)).toBeVisible({ timeout: TIMEOUT });

        // Renamed from the same place, and the tree carries that too.
        await renameInput.fill('grown-in-the-tree.md');
        await page.keyboard.press('Enter');
        await expect(treeRow(page, `${OTHER}/grown-in-the-tree.md`)).toBeVisible({ timeout: TIMEOUT });
        await expect(treeRow(page, `${OTHER}/New Markdown.md`)).toHaveCount(0);

        // None of it moved the browser: the document area is still showing the browsed folder,
        // whose own listing never held any of these rows.
        await expect(page).toHaveURL(new RegExp(`${BROWSED}$`));
        await expect(page.getByTestId(`browser-item-${BROWSED}/note.md`)).toBeVisible();
        await expect(page.getByTestId(`browser-item-${OTHER}/grown-in-the-tree.md`)).toHaveCount(0);

        // And the row goes when the file does.
        await rowMenu(page, `${OTHER}/grown-in-the-tree.md`, 'Delete');
        await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
        await expect(treeRow(page, `${OTHER}/grown-in-the-tree.md`)).toHaveCount(0, { timeout: TIMEOUT });
        await expect(treeRow(page, `${OTHER}/alpha-only.md`)).toBeVisible();
    });
});
