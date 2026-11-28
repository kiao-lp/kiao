import { test, expect, resetViewState } from '../harness';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });
test.afterEach(resetViewState);

test.beforeEach(async ({ page }) => {
    const stamp = { createdAt: '2026-10-25T08:00:00Z', updatedAt: '2026-10-25T08:00:00Z', revision: 1 };
    const note = (id: string, x: number, markdown: string, size: { w: number; h?: number } = { w: 180, h: 100 }) => ({
        id, type: 'note', status: 'ready', note: markdown, spot: { x, y: 40 }, size, ...stamp,
    });
    const longText = `${'A paragraph of the note.\n\n'.repeat(12)}End of the note.`;
    const board = {
        board: { id: 'notes', slug: 'notes', name: 'Notes', archived: false, ...stamp },
        flowNodes: [
            note('long', 40, longText),
            note('short', 240, 'A short note.\n\n[**Welcome**](/welcome.md)'),
            note('auto', 440, longText, { w: 180 }),
        ],
        workflows: [], cursor: 0,
    };
    await page.route('**/api/{hybridflow,agentic}/**', async route => {
        const path = new URL(route.request().url()).pathname.replace(/^\/api\/(?:hybridflow|agentic)/, '');
        if (path === '/boards/notes') {
            await route.fulfill({ json: board });
        } else if (path === '/boards') {
            await route.fulfill({ json: { boards: [board.board] } });
        } else if (path === '/changes') {
            await route.abort();
        } else {
            await route.fulfill({ json: { agents: [], runners: [] } });
        }
    });

    await page.goto('boards/notes');
});

test('scrolls overflowing notes within their cards', async ({ page }) => {
    const bodyOf = (id: string) => page.locator(`[data-flow-node-id="${id}"]`).getByTestId('flow-node-note-body');
    const long = bodyOf('long');
    const lastParagraph = long.getByText('End of the note.');
    await expect(long).toBeInViewport();
    await expect(lastParagraph).not.toBeInViewport();
    const scrollbarWidth = await long.evaluate(el => el.offsetWidth - el.clientWidth);
    expect(scrollbarWidth).toBeGreaterThan(0);
    for (const id of ['short', 'auto']) {
        const body = bodyOf(id);
        expect(await body.evaluate(el => el.scrollHeight - el.clientHeight)).toBe(0);
        expect(await body.evaluate(el => el.offsetWidth - el.clientWidth)).toBe(0);
    }

    const box = (await long.boundingBox())!;
    const scrollbarX = box.x + box.width - scrollbarWidth / 2;
    await page.mouse.move(scrollbarX, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(scrollbarX, box.y + 30, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => long.evaluate(el => el.scrollTop)).toBeGreaterThan(0);

    await long.hover();
    await page.mouse.wheel(0, 1000);
    await expect(lastParagraph).toBeInViewport();
});

for (const activation of ['mouse', 'keyboard']) {
    test(`follows a note link with the ${activation}`, async ({ page }) => {
        const link = page.getByTestId('flow-node-note-body').getByRole('link', { name: 'Welcome', exact: true });
        const root = page.locator('html');
        await root.evaluate(el => { el.dataset.noteLinkProbe = 'retained'; });

        if (activation === 'mouse') await link.click();
        else await link.press('Enter');

        await expect(page).toHaveURL(/\/dashboard\/welcome\.md$/);
        await expect(root).toHaveAttribute('data-note-link-probe', 'retained');
    });
}

test('moves a note by dragging its plain text', async ({ page }) => {
    const text = page.getByTestId('flow-node-note-body').getByText('A short note.', { exact: true });
    await expect(text).toBeVisible();
    const box = (await text.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const move = page.waitForRequest(request => request.method() === 'PATCH'
        && new URL(request.url()).pathname === '/api/hybridflow/boards/notes/flow-nodes/short');

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y + 30, { steps: 5 });
    await page.mouse.up();

    expect((await move).postDataJSON()).toEqual({ spot: { x: 280, y: 70 } });
});
