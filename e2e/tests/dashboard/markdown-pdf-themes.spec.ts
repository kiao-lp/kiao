import { test, expect, workerApi, type Page, type APIRequestContext } from '../harness';

const FILE = 'smoke/pdf-theme-export.md';
const THEME = 'kiao-user-config/pdf-themes/company-test.json';
const BROKEN = 'kiao-user-config/pdf-themes/broken-test.json';

async function write(request: APIRequestContext, path: string, content: string) {
    const response = await request.put(`${workerApi()}/update?path=${encodeURIComponent(path)}`, {
        multipart: { file: { name: path.split('/').pop()!, mimeType: 'text/plain', buffer: Buffer.from(content) } },
    });
    expect(response.ok()).toBeTruthy();
}

async function openExportDialog(page: Page) {
    // The previous dialog's close animation still holds its Export button for a moment.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('export-theme-group').getByRole('radio', { name: 'Default', exact: true })).toBeVisible();
    return dialog;
}

async function exportPdfTheme(page: Page, label: string) {
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: label, exact: true }).click();
    const popupReady = page.waitForEvent('popup');
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    const popup = await popupReady;
    await popup.waitForLoadState('domcontentloaded');
    return popup;
}

test.beforeEach(async ({ page, request }) => {
    await write(request, FILE, '# Printable document\n\nSome text.\n\n## Second heading\n\nMore text.');
    await page.goto(FILE);
    await expect(page.locator('.configured-markdown-container')).toBeVisible();
});

test.afterEach(async ({ request }) => {
    for (const path of [FILE, THEME, BROKEN]) {
        await request.delete(`${workerApi()}/delete?path=${encodeURIComponent(path)}`);
    }
});

test('a fresh store offers the delivered neutral theme and prints the neutral document', async ({ page, request }) => {
    const delivered = await request.get(`${workerApi()}/getFile?path=kiao-user-config/pdf-themes/neutral.json`);
    expect(delivered.ok()).toBeTruthy();
    expect((await delivered.json()).label).toBe('Default');

    const dialog = await openExportDialog(page);
    await expect(dialog.getByTestId('export-theme-group').getByRole('radio')).toHaveCount(1);
    const popup = await exportPdfTheme(page, 'Default');
    await expect(popup.locator('h1')).toHaveText('Printable document');
    await expect(popup.locator('h1')).toHaveCSS('color', 'rgb(26, 26, 26)');
    await expect(popup.locator('header')).toHaveCount(0);
    await popup.close();
});

test('a theme copied into the running store controls the export and is reread after edits', async ({ page, request }) => {
    const theme = {
        label: 'Company test',
        variables: { '--heading-1': '#174a7e' },
        css: 'body { font-family: Arial, sans-serif; } .company-header { border-bottom: 2px solid #174a7e; }',
        headerHtml: '<header class="company-header"><strong>{{title}}</strong><time>{{date}}</time></header>',
    };
    await write(request, THEME, JSON.stringify(theme));
    // A bad neighbour must not break the menu or the delivered theme.
    await write(request, BROKEN, '{invalid json');

    const dialog = await openExportDialog(page);
    await expect(dialog.getByTestId('export-theme-group').getByRole('radio', { name: 'Company test', exact: true })).toBeVisible();
    await expect(dialog.getByTestId('export-theme-group').getByRole('radio')).toHaveCount(2);
    const popup = await exportPdfTheme(page, 'Company test');
    await expect(popup.locator('h1')).toHaveCSS('color', 'rgb(23, 74, 126)');
    await expect(popup.locator('body')).toHaveCSS('font-family', 'Arial, sans-serif');
    await expect(popup.locator('.company-header strong')).toHaveText('pdf-theme-export');
    await expect(popup.locator('.company-header time')).toHaveText(/^\d{2}\/\d{2}\/\d{4}$/);
    await expect(popup.locator('.company-header')).toHaveCSS('border-bottom-width', '2px');
    await popup.close();
    // The theme only changes the print tab.
    await expect(page.locator('.company-header')).toHaveCount(0);

    theme.label = 'Company edited';
    theme.variables['--heading-1'] = '#205020';
    await write(request, THEME, JSON.stringify(theme));
    const reopened = await openExportDialog(page);
    await expect(reopened.getByTestId('export-theme-group').getByRole('radio', { name: 'Company edited', exact: true })).toBeVisible();
    await expect(reopened.getByTestId('export-theme-group').getByRole('radio', { name: 'Company test', exact: true })).toHaveCount(0);
    const editedPopup = await exportPdfTheme(page, 'Company edited');
    await expect(editedPopup.locator('h1')).toHaveCSS('color', 'rgb(32, 80, 32)');
    await editedPopup.close();
});
