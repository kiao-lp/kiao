import { test, expect, APIRequestContext, Page, MINIMAL_APP, MINIMAL_WORKER_PORT, workerApi, resetViewState } from '../harness';

const sourceApi = () => `http://localhost:${MINIMAL_WORKER_PORT}`;

test.afterEach(resetViewState);

const showTree = async (page: Page) => {
    await expect(page.locator('.cms-top-banner')).toBeVisible();
    if (!await page.getByTestId('nav-tree').isVisible()) await page.getByTestId('bar-toggle-left').click();
    await expect(page.getByTestId('nav-tree')).toBeVisible();
};

const writeFile = async (request: APIRequestContext, api: string, path: string, content: string | Buffer) => {
    const response = await request.put(`${api}/update?path=${encodeURIComponent(path)}`, {
        multipart: { file: { name: path.split('/').pop()!, mimeType: 'application/octet-stream', buffer: Buffer.from(content) } },
    });
    expect(response.ok()).toBeTruthy();
};

const copyContents = async (page: Page, path: string) => {
    await showTree(page);
    await page.getByTestId('nav-tree').getByTestId(`nav-item-${path}`).click({ button: 'right' });
    await page.getByText('Copy as...', { exact: true }).hover();
    await page.getByText('Copy text files with contents', { exact: true }).click();
    await expect(page.getByText(/[Tt]ext files? copied!/)).toBeVisible();
};

const pasteContents = async (page: Page) => {
    const completed = page.waitForResponse(response => response.url().includes('/copyBatch') && response.request().method() === 'POST');
    await page.getByText('Paste text files', { exact: true }).click();
    expect((await completed).ok()).toBeTruthy();
};

test('copies a text selection between independent instances and preserves existing files', async ({ browser, page, context, request }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const sourceContext = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const source = await sourceContext.newPage();
    const folder = `clipboard-source-${Date.now()}`;
    const target = `clipboard-target-${Date.now()}`;
    const files = [
        { name: 'ébauche.arch.md', content: '\ufeff# Bonjour 🙂\r\n\r\n```json\n{"value":"a\\nb"}\n```\n' },
        { name: 'empty.json', content: '' },
        { name: 'style.css', content: 'body { color: red; }\n' },
    ];
    try {
        for (const file of files) await writeFile(request, sourceApi(), `${folder}/${file.name}`, file.content);
        await writeFile(request, sourceApi(), `${folder}/image.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]));
        await writeFile(request, workerApi(), `${target}/${files[0].name}`, 'existing text');

        await source.goto(`${MINIMAL_APP}/${folder}`);
        await showTree(source);
        await expect(source.getByTestId(`browser-item-${folder}/${files[0].name}`)).toBeVisible();
        for (const file of files) {
            await source.getByTestId(`browser-item-${folder}/${file.name}`).click({ modifiers: ['Control'] });
        }
        await source.getByTestId(`browser-item-${folder}/image.png`).click({ modifiers: ['Control'] });
        await source.getByTestId('nav-tree').getByTestId(`nav-item-${folder}/${files[0].name}`).click({ button: 'right' });
        await source.getByText('Copy as...', { exact: true }).hover();
        await expect(source.getByText('Copy text files with contents', { exact: true })).toHaveCount(0);
        await source.keyboard.press('Escape');
        await source.getByTestId(`browser-item-${folder}/${files[0].name}`).click();
        for (const file of files.slice(1)) {
            await source.getByTestId(`browser-item-${folder}/${file.name}`).click({ modifiers: ['Control'] });
        }
        await copyContents(source, `${folder}/${files[0].name}`);
        await sourceContext.close();

        await page.goto('works');
        await page.bringToFront();
        await showTree(page);
        await page.getByTestId(`nav-toggle-${target}`).click();
        await page.getByTestId('nav-tree').getByTestId(`nav-item-${target}`).click({ button: 'right' });
        await pasteContents(page);
        await expect(page.getByText('3 text files pasted!', { exact: true })).toBeVisible();
        const names = ['ébauche 1.arch.md', 'empty.json', 'style.css'];
        for (const [index, file] of files.entries()) {
            const path = `${target}/${names[index]}`;
            const response = await request.get(`${workerApi()}/getFile?path=${encodeURIComponent(path)}`);
            expect(response.ok(), path).toBeTruthy();
            expect(await response.body(), path).toEqual(Buffer.from(file.content));
            await expect(page.getByTestId('nav-tree').getByTestId(`nav-item-${path}`)).toBeVisible();
        }
        const original = await request.get(`${workerApi()}/getFile?path=${encodeURIComponent(`${target}/${files[0].name}`)}`);
        expect(await original.text()).toBe('existing text');
    } finally {
        await sourceContext.close();
        await request.delete(`${sourceApi()}/delete?path=${encodeURIComponent(folder)}`);
        await request.delete(`${workerApi()}/delete?path=${encodeURIComponent(target)}`);
    }
});

test('copies one file, pastes into the root and hides paste after the clipboard changes', async ({ page, context, request }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const name = `clipboard-single-${Date.now()}.txt`;
    const folder = `clipboard-single-${Date.now()}`;
    try {
        await writeFile(request, workerApi(), `${folder}/${name}`, 'single file\n');
        await page.goto(folder);
        await copyContents(page, `${folder}/${name}`);
        await page.getByTestId('nav-item-root').click({ button: 'right' });
        await pasteContents(page);
        await expect(page.getByText('Text file pasted!', { exact: true })).toBeVisible();
        const pasted = await request.get(`${workerApi()}/getFile?path=${encodeURIComponent(name)}`);
        expect(await pasted.text()).toBe('single file\n');

        await page.evaluate(() => navigator.clipboard.writeText('ordinary text'));
        await page.getByTestId('nav-item-root').click({ button: 'right' });
        await expect(page.getByText('Paste text files', { exact: true })).toHaveCount(0);
        await page.keyboard.press('Escape');

        await copyContents(page, `${folder}/${name}`);
        await page.locator('.cms-folder-browser-area').dispatchEvent('contextmenu', { clientX: 500, clientY: 200 });
        await pasteContents(page);
        await expect(page.getByText('Text file pasted!', { exact: true })).toBeVisible();
        const duplicate = await request.get(`${workerApi()}/getFile?path=${encodeURIComponent(`${folder}/${name.replace('.txt', ' 1.txt')}`)}`);
        expect(await duplicate.text()).toBe('single file\n');
    } finally {
        await request.delete(`${workerApi()}/delete?path=${encodeURIComponent(folder)}`);
        await request.delete(`${workerApi()}/delete?path=${encodeURIComponent(name)}`);
    }
});
