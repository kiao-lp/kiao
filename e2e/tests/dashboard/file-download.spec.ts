import { readFile } from 'node:fs/promises';
import { test, expect, workerApi, resetViewState } from '../harness';

test.afterEach(resetViewState);

test('downloads the original bytes from the file browser', async ({ page, request }) => {
    const folder = `download-${Date.now()}`;
    const name = 'épisode.txt';
    const path = `${folder}/${name}`;
    const content = Buffer.from('Document privé — café\r\n\u0000fin\n');
    const uploaded = await request.put(`${workerApi()}/update?path=${encodeURIComponent(path)}`, {
        multipart: { file: { name, mimeType: 'application/octet-stream', buffer: content } },
    });
    expect(uploaded.ok()).toBeTruthy();

    try {
        await page.goto(folder);
        const row = page.getByTestId(`browser-item-${path}`);
        await expect(row).toBeVisible();
        await row.click({ button: 'right' });
        const downloadItem = page.getByText('Download', { exact: true });
        await expect(downloadItem).toBeVisible();
        const downloading = page.waitForEvent('download');
        await downloadItem.click();
        const download = await downloading;
        expect(download.suggestedFilename()).toBe(name);
        expect(await download.failure()).toBeNull();
        const saved = await download.path();
        expect(saved).toBeTruthy();
        expect(await readFile(saved!)).toEqual(content);
    } finally {
        const removed = await request.delete(`${workerApi()}/delete?path=${encodeURIComponent(folder)}`);
        expect(removed.ok()).toBeTruthy();
    }
});
