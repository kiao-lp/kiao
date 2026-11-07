import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { test, expect, workerApi, type APIRequestContext } from '../harness';

const FILE = 'smoke/word-theme-export.md';
const THEME = 'kiao-user-config/pdf-themes/company-word-test.json';

async function write(request: APIRequestContext, path: string, content: string) {
    const response = await request.put(`${workerApi()}/update?path=${encodeURIComponent(path)}`, {
        multipart: { file: { name: path.split('/').pop()!, mimeType: 'text/plain', buffer: Buffer.from(content) } },
    });
    expect(response.ok()).toBeTruthy();
}

test.beforeEach(async ({ request }) => {
    await write(request, FILE, '# Themed document\n\nSome text.\n');
});

test.afterEach(async ({ request }) => {
    for (const path of [FILE, THEME]) {
        await request.delete(`${workerApi()}/delete?path=${encodeURIComponent(path)}`);
    }
});

test('the Word theme menu paints the document with the picked store theme', async ({ page, request }) => {
    test.setTimeout(120000);
    await write(request, THEME, JSON.stringify({
        label: 'Company word test',
        variables: { '--heading-1': '#174a7e' },
    }));
    await page.goto(FILE);
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 30000 });

    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: 'Word (.docx)', exact: true }).click();
    await expect(dialog.getByRole('radio', { name: 'Company word test', exact: true })).toBeVisible();
    await dialog.getByRole('radio', { name: 'Company word test', exact: true }).click();

    const ready = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await ready;
    expect(download.suggestedFilename()).toBe('word-theme-export.docx');
    const path = await download.path();
    expect(path).toBeTruthy();
    await expect(page.locator('.ant-message-success')).toContainText('Word document downloaded');

    const zip = await JSZip.loadAsync(await readFile(path!));
    const document = new DOMParser().parseFromString(
        await zip.file('word/document.xml')!.async('string'), 'application/xml');
    const colors = Array.from(document.getElementsByTagName('w:color'))
        .map(element => element.getAttribute('w:val'));
    expect(colors).toContain('174A7E');
});
