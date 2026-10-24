import { test, expect, resetViewState } from '../harness';

/**
 * E2E: creating, renaming and deleting, for a file and for a folder.
 *
 * One script, two subjects. The plugin that answers `+ New` differs — a folder is the file
 * browser's own, a `.mmap.json` is `mindmap-edit`'s — but from there on the promise is the same
 * one for every type in the store, and it is a promise about *two* views: the row appears, is
 * renamed and goes in the file tree and in the browser together, and the browser stays in
 * the folder it was in rather than jumping to the root.
 *
 * Both are created somewhere other than the root, so the paths under test contain a slash.
 */

const TIMEOUT = 10000;

interface Subject {
    /** What the New menu calls it. */
    entry: string;
    /** The folder it is created in. */
    parent: string;
    /** The name the creating plugin gives it. */
    created: string;
    /** What it is renamed to — an extension is part of a file's name and is kept. */
    renamed: string;
}

const subjects: Subject[] = [
    { entry: 'Folder', parent: 'folder-a', created: 'New folder', renamed: 'My Test Folder' },
    {
        entry: 'Mindmap', parent: 'works',
        created: 'New Mindmap.mmap.json', renamed: 'My Other Mindmap.mmap.json',
    },
];

test.afterEach(resetViewState);

for (const { entry, parent, created, renamed } of subjects) {
    test(`${entry.toLowerCase()}: created, renamed and deleted in both views`, async ({ page }) => {
        const createdPath = `${parent}/${created}`;
        const renamedPath = `${parent}/${renamed}`;
        const inNav = (path: string) => page.getByTestId(`nav-item-${path}`);
        const inBrowser = (path: string) => page.getByTestId(`browser-item-${path}`);

        await page.goto(parent);
        await expect(page).toHaveURL(new RegExp(parent));
        await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
        await page.getByTestId('bar-toggle-left').click();
        await expect(page.getByTestId('nav-tree')).toBeVisible({ timeout: TIMEOUT });

        // 1. Created from the New menu, in the folder the browser is on.
        await page.keyboard.press('Escape'); // nothing selected: New acts on the current folder
        await page.getByTestId('new-button-toolbar').click();
        await page.locator('.ant-dropdown-menu').getByText(entry, { exact: true }).click();

        // 2. It is in both views, and the browser did not leave the folder to show it.
        await expect(inNav(createdPath)).toBeVisible({ timeout: TIMEOUT });
        await expect(inBrowser(createdPath)).toBeVisible({ timeout: TIMEOUT });
        await expect(page).toHaveURL(new RegExp(`${parent}$`));

        // 3. Creating selects it and opens the rename modal on its name, ready to be typed over.
        const renameInput = page.getByTestId('rename-input');
        await expect(renameInput).toBeVisible({ timeout: TIMEOUT });
        await expect(renameInput).toBeFocused();
        await expect(renameInput).toHaveValue(created);

        // 4. Renamed: the old row goes from both views and the new one arrives in both.
        await renameInput.fill(renamed);
        await page.keyboard.press('Enter');
        await expect(inNav(renamedPath)).toBeVisible({ timeout: TIMEOUT });
        await expect(inBrowser(renamedPath)).toBeVisible();
        await expect(inNav(createdPath)).toHaveCount(0);
        await expect(inBrowser(createdPath)).toHaveCount(0);

        // 5. Deleted with the Delete key, which acts on what the pointer is over and asks first.
        await page.keyboard.press('Escape'); // the hotkey wants no active selection
        await inBrowser(renamedPath).hover();
        await page.keyboard.press('Delete');
        const confirm = page.getByRole('dialog').getByRole('button', { name: 'Delete' });
        await expect(confirm).toBeVisible({ timeout: TIMEOUT });
        await confirm.click();

        await expect(inNav(renamedPath)).toHaveCount(0, { timeout: TIMEOUT });
        await expect(inBrowser(renamedPath)).toHaveCount(0);
    });
}
