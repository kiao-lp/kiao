import { test, expect, Page, workerApi, resetViewState, flushViewState } from '../harness';

const BOARD_TAB = 'hybridflow-ui-board';
const FIRST = 'board-panel-notes.md';
const SECOND = 'board-panel-second.txt';

const board = {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'major', name: 'Major', archived: false, revision: 1,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};

// The harness has no boards backend. These responses exercise the real board UI and HTTP client.
const serveBoard = async (page: Page) => {
    await page.route('**/api/hybridflow/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/api/hybridflow', '');
        if (path === '/changes') return route.abort();
        const nodes = [
            { id: 'review', title: 'Review draft', type: 'human', tags: ['work'], spot: { x: 40, y: 80 } },
            { id: 'choice', title: 'Choose path', type: 'gateway', tags: ['route'], spot: { x: 450, y: 80 } },
        ].map(node => ({ ...node, status: 'ready', body: '', settings: {}, onSuccess: {},
            createdAt: board.createdAt, updatedAt: board.updatedAt, revision: 1 }));
        const body = path === '/boards/major'
            ? { board, flowNodes: nodes, flowNodeClasses: [], workflows: [], workflowClasses: [], cursor: 0 }
            : path === '/boards' ? { boards: [board] }
            : { agents: [], runners: [], flowNodeClasses: [], workflowClasses: [] };
        await route.fulfill({ json: body });
    });
};

const placeBoard = async (page: Page, area: string) => {
    const cell = page.getByTestId(`layout-cell-${BOARD_TAB}-${area}`);
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.keyboard.press('Escape');
        await page.locator('.cms-top-banner .anticon-more').click();
        await page.getByText('Show', { exact: true }).hover();
        const tab = page.getByTestId(`show-tab-${BOARD_TAB}`);
        await expect(tab).toBeVisible();
        await tab.hover();
        if (await cell.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false)) break;
    }
    await cell.click();
    await page.keyboard.press('Escape');
    await page.mouse.move(0, 0);
    await page.getByTestId(`tool-bar-${area}`).getByRole('tab', { name: 'Board', exact: true }).click();
};

test.beforeEach(async ({ page, request }) => {
    await resetViewState();
    await serveBoard(page);
    for (const path of [FIRST, SECOND]) {
        const response = await request.put(`${workerApi()}/update?path=${path}`, {
            multipart: { file: { name: path, mimeType: 'text/markdown',
                buffer: Buffer.from(`[Open board](/boards/major)\n\n[Other notes](/${SECOND})\n`) } },
        });
        expect(response.ok()).toBeTruthy();
    }
});

test.afterEach(async ({ page, request }) => {
    await flushViewState(page);
    for (const path of [FIRST, SECOND]) {
        await request.delete(`${workerApi()}/delete?path=${path}`);
    }
    await resetViewState();
});

test('board and document have separate panels and editor stacks', async ({ page }) => {
    await page.goto(FIRST);
    const source = page.locator('.cms-document-area .cm-content').first();
    await expect(source).toBeVisible();
    await source.evaluate(element => { element.setAttribute('data-board-probe', 'retained'); });
    await page.getByRole('link', { name: 'Open board', exact: true }).click();

    const center = page.getByTestId('tool-bar-center');
    await expect(center.getByRole('tab', { name: 'Board', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('flow-node-card')).toHaveCount(2);
    await expect(source).toHaveAttribute('data-board-probe', 'retained');
    await expect(source).not.toBeVisible();

    await page.getByTestId('flow-node-card').filter({ hasText: 'Review draft' }).dblclick();
    const editor = page.getByTestId('central-panel-flow-node-editor');
    await expect(editor).toBeVisible();
    await expect(page.getByTestId('board-panel').getByRole('textbox', { name: 'Node title' }))
        .toHaveValue('Review draft');
    await expect(page.locator('.cms-document-area').getByTestId('central-stack')).toHaveCount(0);
    await editor.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByTestId('board-filter-tag').filter({ hasText: 'work' }).click();
    await expect(page.getByTestId('flow-node-card')).toHaveCount(1);

    await center.getByRole('tab', { name: 'Document', exact: true }).click();
    await expect(source).toBeVisible();
    await expect(source).toHaveAttribute('data-board-probe', 'retained');
    await page.getByRole('link', { name: 'Other notes', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(SECOND.replace('.', '\\.') + '$'));
    await expect(source).toBeVisible();

    await center.getByRole('tab', { name: 'Board', exact: true }).click();
    await expect(page.getByTestId('flow-node-card')).toHaveCount(1);
    await page.getByTestId('flow-node-card').click();
    await expect(page.getByTestId('expand-flow-node')).toBeVisible();
    await center.getByRole('tab', { name: 'Document', exact: true }).click();
    await page.getByTestId('expand-flow-node').click();
    await expect(center.getByRole('tab', { name: 'Board', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('board-panel').getByTestId('central-panel-flow-node-editor')).toBeVisible();
    await editor.getByRole('button', { name: 'Close', exact: true }).click();

    await placeBoard(page, 'right');
    await expect(page.getByTestId('tool-bar-right').getByTestId('board-panel')).toBeVisible();
    await expect(source).toBeVisible();
    await expect(page.getByTestId('board-filter-count')).toHaveText('1 of 2 shown');
    await flushViewState(page);

    await page.reload();
    await expect(page.getByTestId('tool-bar-right').getByTestId('boards-page')).toBeVisible();
    await page.getByTestId('tool-bar-right').getByTestId('board-row-major').getByRole('link').click();
    await expect(page.getByTestId('tool-bar-right').getByTestId('flow-node-card')).toHaveCount(2);
    await expect(source).toBeVisible();
});

test('direct board URLs select the Board panel and the bare prefix lists boards there', async ({ page }) => {
    await page.goto('boards/major');
    const center = page.getByTestId('tool-bar-center');
    await expect(center.getByRole('tab', { name: 'Board', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('board-panel').getByTestId('flow-node-card')).toHaveCount(2);
    await expect(center.getByRole('tab', { name: 'Document', exact: true })).toBeVisible();

    await page.goto('boards');
    await expect(page.getByTestId('board-panel').getByTestId('boards-page')).toBeVisible();
    await page.getByTestId('board-row-major').getByRole('link').click();
    await expect(page.getByTestId('board-panel').getByTestId('flow-node-card')).toHaveCount(2);
});
