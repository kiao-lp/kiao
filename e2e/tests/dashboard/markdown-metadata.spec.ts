import { test, expect, fileUrl, resetViewState, workerApi, type APIRequestContext, type Page } from '../harness';

const FILE = 'smoke/markdown-metadata.md';
const BODY = '\n# Metadata document\n\nThe body stays intact.\n\n---\n\nA body horizontal rule.\n';
const SOURCE = '---\n# Keep this comment\nstatus: DRAFT\nrole: PRIMARY_SOURCE\nprovenance: Original source description.\ncustom: keep-me\n---\n' + BODY;
const DESCRIPTIONS: Record<string, string> = {
    DRAFT: 'Draft — being prepared for publication',
    EXPERIMENTAL: 'Experimental — neither a source nor intended for publication',
    APPROVED: 'Approved — validated and published',
    PRIMARY_SOURCE: 'Primary source — edited directly',
    DERIVED: 'Derived — generated from other sources',
};

async function write(request: APIRequestContext, source: string) {
    const response = await request.put(`${workerApi()}/update?path=${encodeURIComponent(FILE)}`, {
        multipart: { file: { name: 'markdown-metadata.md', mimeType: 'text/markdown', buffer: Buffer.from(source) } },
    });
    expect(response.ok()).toBeTruthy();
}

const saved = () => fetch(fileUrl(FILE)).then(response => response.text());
const selector = (page: Page, label: string) => page.locator('.ant-select')
    .filter({ has: page.getByRole('combobox', { name: label, exact: true }) });

async function expectSelection(page: Page, label: string, value?: string) {
    const select = selector(page, label);
    await expect(select).toHaveAttribute('title', `${label}: ${value ? DESCRIPTIONS[value] : 'Not set'}`);
    await expect(select).toHaveText('');
    await expect(select.locator('.ant-select-content .anticon')).toBeVisible();
    expect((await select.boundingBox())!.width).toBeLessThanOrEqual(36);
}

async function pick(page: Page, label: string, value: string) {
    const select = selector(page, label);
    await select.click();
    const dropdown = page.locator('.ant-select-dropdown:visible');
    const option = dropdown.getByText(DESCRIPTIONS[value], { exact: true });
    await expect(option).toBeVisible();
    expect((await dropdown.boundingBox())!.width).toBeGreaterThan((await select.boundingBox())!.width);
    expect(await dropdown.locator('.ant-select-item-option-content').evaluateAll(items =>
        items.every(item => item.scrollWidth <= item.clientWidth))).toBe(true);
    await option.click();
    await expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0);
}

test.beforeEach(async ({ request }) => {
    await resetViewState();
    await write(request, SOURCE);
});

test.afterEach(async ({ request }) => {
    await request.delete(`${workerApi()}/delete?path=${encodeURIComponent(FILE)}`);
});

test('preview hides YAML while source and panel selectors show it, and status changes persist', async ({ page }) => {
    await page.goto(FILE);
    const preview = page.locator('.configured-markdown-container');
    await expect(preview.getByRole('heading', { name: 'Metadata document' })).toBeVisible();
    await expect(preview).not.toContainText('DRAFT');
    await expect(preview).not.toContainText('Original source description.');
    await expect(preview).not.toContainText('keep-me');
    await expect(preview.locator('hr')).toHaveCount(1);
    await expect(page.locator('.cm-content').first()).toContainText('status: DRAFT');
    await expectSelection(page, 'Document status', 'DRAFT');
    await expectSelection(page, 'Document role', 'PRIMARY_SOURCE');

    for (const status of ['EXPERIMENTAL', 'APPROVED', 'DRAFT']) {
        await pick(page, 'Document status', status);
        await expect.poll(saved).toContain(`status: ${status}`);
        await expectSelection(page, 'Document status', status);
    }
    const source = await saved();
    expect(source).toContain('# Keep this comment');
    expect(source).toContain('custom: keep-me');
    expect(source.endsWith(BODY)).toBe(true);
    await page.reload();
    await expectSelection(page, 'Document status', 'DRAFT');
});

test('both roles open provenance, autosave descriptions and allow reopening the current role', async ({ page }) => {
    await page.goto(FILE);
    await pick(page, 'Document role', 'DERIVED');
    let dialog = page.getByRole('dialog', { name: 'Document provenance' });
    await expect(dialog.getByLabel('Provenance description')).toHaveValue('Original source description.');
    const description = 'Sources: "report" #1\nReviewed résumé — https://example.com/source';
    await dialog.getByLabel('Provenance description').fill(description);
    await dialog.locator('.ant-modal-footer').getByRole('button', { name: 'Close', exact: true }).click();
    await expect.poll(saved).toContain('Reviewed résumé');
    expect(await saved()).toContain('role: DERIVED');
    expect((await saved()).endsWith(BODY)).toBe(true);

    await page.reload();
    await expectSelection(page, 'Document role', 'DERIVED');
    await pick(page, 'Document role', 'DERIVED');
    dialog = page.getByRole('dialog', { name: 'Document provenance' });
    await expect(dialog.getByLabel('Provenance description')).toHaveValue(description);
    await dialog.locator('.ant-modal-footer').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).not.toBeVisible();

    await pick(page, 'Document role', 'PRIMARY_SOURCE');
    dialog = page.getByRole('dialog', { name: 'Document provenance' });
    await expect(dialog.getByLabel('Provenance description')).toHaveValue(description);
    await dialog.getByLabel('Provenance description').fill('Written directly from observations.');
    await dialog.locator('.ant-modal-footer').getByRole('button', { name: 'Close', exact: true }).click();
    await expect.poll(saved).toContain('Written directly from observations.');
    expect(await saved()).toContain('role: PRIMARY_SOURCE');
    await page.reload();
    await pick(page, 'Document role', 'PRIMARY_SOURCE');
    await expect(page.getByRole('dialog', { name: 'Document provenance' })
        .getByLabel('Provenance description')).toHaveValue('Written directly from observations.');
});

test('adding metadata to a plain file keeps unsaved source edits', async ({ page, request }) => {
    const plain = '# Plain document\n\nOriginal body.\n';
    await write(request, plain);
    await page.goto(FILE);
    const editor = page.locator('.cm-content').first();
    await expect(editor).toContainText('Original body.');
    await expectSelection(page, 'Document status');
    await expectSelection(page, 'Document role');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText('\nAn unsaved body edit.');
    expect(await saved()).toBe(plain);
    await pick(page, 'Document status', 'APPROVED');
    await expect.poll(saved).toContain('status: APPROVED');
    expect(await saved()).toContain('An unsaved body edit.');
    expect(await saved()).toContain(plain);
    await pick(page, 'Document role', 'PRIMARY_SOURCE');
    const dialog = page.getByRole('dialog', { name: 'Document provenance' });
    await expect(dialog.getByLabel('Provenance description')).toHaveValue('');
    await dialog.locator('.ant-modal-footer').getByRole('button', { name: 'Close', exact: true }).click();
    await expect.poll(saved).toContain('role: PRIMARY_SOURCE');
});

test('selectors follow source and disk changes, and invalid YAML can be repaired in source', async ({ page, request }) => {
    await page.goto(FILE);
    const editor = page.locator('.cm-content').first();
    await expect(editor).toContainText('status: DRAFT');
    await editor.fill(SOURCE.replace('DRAFT', 'EXPERIMENTAL').replace('PRIMARY_SOURCE', 'DERIVED'));
    await expectSelection(page, 'Document status', 'EXPERIMENTAL');
    await expectSelection(page, 'Document role', 'DERIVED');
    await expect.poll(saved).toContain('status: EXPERIMENTAL');

    // HTTP Last-Modified has second precision; the external write needs a later timestamp.
    const savedSecond = Math.floor(Date.now() / 1000);
    await expect.poll(() => Math.floor(Date.now() / 1000)).toBeGreaterThan(savedSecond);
    await write(request, SOURCE.replace('DRAFT', 'APPROVED'));
    await expectSelection(page, 'Document status', 'APPROVED');
    await expectSelection(page, 'Document role', 'PRIMARY_SOURCE');

    await editor.fill('---\nstatus: [unfinished\n---\n\n# Body after invalid header');
    await expect(page.getByRole('combobox', { name: 'Document status' })).toBeDisabled();
    await expect(page.getByRole('combobox', { name: 'Document role' })).toBeDisabled();
    await expect(page.locator('.configured-markdown-container')).toContainText('Body after invalid header');
    await editor.fill(SOURCE);
    await expect(page.getByRole('combobox', { name: 'Document status' })).toBeEnabled();
    await expectSelection(page, 'Document status', 'DRAFT');
    await expect.poll(saved).toBe(SOURCE);
});
