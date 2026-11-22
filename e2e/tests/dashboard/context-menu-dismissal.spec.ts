import { test, expect, Page, resetViewState } from '../harness';

const menus = (page: Page) => page.locator('.ant-dropdown:visible');
const fileRow = (page: Page) => page.locator('[data-row-path="folder-a/note.md"]').filter({ has: page.getByTestId('browser-item-folder-a/note.md') });

test.beforeEach(async ({ page }) => {
    await resetViewState();
    await page.goto('folder-a');
    await expect(page.locator('.cms-top-banner')).toBeVisible();
    await expect(fileRow(page)).toBeVisible();
});

test.afterEach(resetViewState);

for (const mode of ['details', 'grid'] as const) {
    test(`${mode}: row and empty-area menus dismiss on an outside click and Escape`, async ({ page }) => {
        if (mode === 'grid') await page.locator('.cms-view-mode-grid').click();
        const area = page.locator(mode === 'grid' ? '.cms-file-grid' : '.cms-folder-browser-area');

        for (const target of ['row', 'empty'] as const) {
            const open = async () => {
                if (target === 'row') await fileRow(page).click({ button: 'right', position: { x: 20, y: 15 } });
                else await area.dispatchEvent('contextmenu', { clientX: 700, clientY: 200 });
                await expect(menus(page)).toHaveCount(1);
                await expect(menus(page).getByText(target === 'row' ? 'Rename' : 'Refresh', { exact: true })).toBeVisible();
            };

            await open();
            await page.getByRole('tab', { name: 'Document', exact: true }).click();
            await expect(menus(page)).toHaveCount(0);
            await open();
            await page.keyboard.press('Escape');
            await expect(menus(page)).toHaveCount(0);
        }
    });
}

test('navigating to another folder from the tree dismisses the row menu', async ({ page }) => {
    await page.getByTestId('bar-toggle-left').click();
    await expect(page.getByTestId('nav-tree')).toBeVisible();
    await fileRow(page).click({ button: 'right', position: { x: 20, y: 15 } });
    await expect(menus(page)).toHaveCount(1);
    await page.getByTestId('nav-item-works').click();
    await expect(page).toHaveURL(/\/works$/);
    await expect(page.getByTestId('browser-item-works/alpha')).toBeVisible();
    await expect(menus(page)).toHaveCount(0);
});

test('browser history navigation dismisses row and empty-area menus', async ({ page }) => {
    await page.getByTestId('bar-toggle-left').click();
    const treeFolder = page.getByTestId('nav-item-works');

    for (const target of ['row', 'empty'] as const) {
        await treeFolder.click();
        await expect(page.getByTestId('browser-item-works/alpha')).toBeVisible();
        if (target === 'row') {
            await page.getByTestId('browser-item-works/alpha').click({ button: 'right' });
        } else {
            await page.locator('.cms-folder-browser-area').dispatchEvent('contextmenu', { clientX: 700, clientY: 200 });
        }
        await expect(menus(page)).toHaveCount(1);
        await page.goBack();
        await expect(fileRow(page)).toBeVisible();
        await expect(menus(page)).toHaveCount(0);
    }
});

test('right-clicking another target replaces the menu and uses the new target', async ({ page }) => {
    await page.getByTestId('bar-toggle-left').click();
    const area = page.locator('.cms-folder-browser-area');
    const treeFolder = page.getByTestId('nav-item-works');

    for (let attempt = 0; attempt < 2; attempt++) {
        await fileRow(page).click({ button: 'right', position: { x: 20, y: 15 } });
        await expect(menus(page).getByText('Replace…', { exact: true })).toBeVisible();

        await area.dispatchEvent('contextmenu', { clientX: 700, clientY: 200 });
        await expect(menus(page)).toHaveCount(1);
        await expect(menus(page).getByText('Refresh', { exact: true })).toBeVisible();
        await expect(menus(page).getByText('Rename', { exact: true })).toHaveCount(0);

        await fileRow(page).click({ button: 'right', position: { x: 20, y: 15 } });
        await expect(menus(page)).toHaveCount(1);
        await expect(menus(page).getByText('Replace…', { exact: true })).toBeVisible();

        await treeFolder.click({ button: 'right' });
        await expect(menus(page)).toHaveCount(1);
        await expect(menus(page).getByText('Replace…', { exact: true })).toHaveCount(0);
        await menus(page).getByText('Rename', { exact: true }).click();
        await expect(page.getByTestId('rename-input')).toHaveValue('works');
        await expect(menus(page)).toHaveCount(0);
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    }
});
