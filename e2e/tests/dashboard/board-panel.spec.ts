import { test, expect, Page, workerApi, resetViewState, flushViewState, showMarkdownEditor } from '../harness';
import { openShowSubmenu } from './layout-menu';

const BOARD_TAB = 'hybridflow-ui-board';
const FIRST = 'board-panel-notes.md';
const SECOND = 'board-panel-second.txt';

const board = {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'major', name: 'Major', archived: false, revision: 1,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};

// The harness has no boards backend. These responses exercise the real board UI and HTTP client.
const serveBoard = async (page: Page, boards = [board]) => {
    await page.route('**/api/hybridflow/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/api/hybridflow', '');
        if (path === '/changes') return route.abort();
        const nodes = [
            { id: 'review', title: 'Review draft', type: 'human', tags: ['work'], spot: { x: 40, y: 80 } },
            { id: 'choice', title: 'Choose path', type: 'gateway', tags: ['route'], spot: { x: 450, y: 80 } },
        ].map(node => ({ ...node, status: 'ready', body: '', settings: {}, onSuccess: {},
            createdAt: board.createdAt, updatedAt: board.updatedAt, revision: 1 }));
        const requested = boards.find(board => path === `/boards/${board.slug}`);
        const body = requested
            ? { board: requested, flowNodes: nodes, flowNodeClasses: [], workflows: [], workflowClasses: [], cursor: 0 }
            : path === '/boards' ? { boards }
            : { agents: [], runners: [], flowNodeClasses: [], workflowClasses: [] };
        await route.fulfill({ json: body });
    });
};

const placeBoard = async (page: Page, area: string) => {
    await openShowSubmenu(page, 'Board');
    await page.getByTestId(`layout-cell-${BOARD_TAB}-${area}`).click();
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

test('board and document have separate panels', async ({ page }) => {
    await page.goto(FIRST);
    await showMarkdownEditor(page);
    const source = page.locator('.cms-document-area .cm-content').first();
    await expect(source).toBeVisible();
    await source.evaluate(element => { element.setAttribute('data-board-probe', 'retained'); });
    await page.getByRole('link', { name: 'Open board', exact: true }).click();

    const center = page.getByTestId('tool-bar-center');
    await expect(center.getByRole('tab', { name: 'Board', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('flow-node-card')).toHaveCount(2);
    await expect(source).toHaveAttribute('data-board-probe', 'retained');
    await expect(source).not.toBeVisible();

    await page.getByTestId('flow-node-card').filter({ hasText: 'Review draft' }).click();
    await expect(page.getByTestId('flow-node-panel').getByTestId('flow-node-title'))
        .toHaveValue('Review draft');
    await expect(page.locator('.cms-document-area').getByTestId('central-stack')).toHaveCount(0);

    await page.locator('.cms-top-banner .anticon-more').click();
    await page.locator('.ant-dropdown-menu:visible').first()
        .getByText('File optimizations…', { exact: true }).click();
    const optimizations = page.getByTestId('central-panel-file-optimizations');
    await expect(optimizations).toBeVisible();
    await expect(center.getByRole('tab', { name: 'Board', exact: true })).toHaveAttribute('aria-selected', 'true');
    await optimizations.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByTestId('board-filter-tag').filter({ hasText: 'work' }).click();
    await expect(page.getByTestId('flow-node-card')).toHaveCount(1);

    await center.getByRole('tab', { name: 'Document', exact: true }).click();
    await expect(source).toBeVisible();
    await expect(source).toHaveAttribute('data-board-probe', 'retained');
    await page.getByRole('link', { name: 'Other notes', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(SECOND.replace('.', '\\.') + '$'));
    await expect(page).toHaveTitle('board-panel-second');
    await expect(source).toBeVisible();
    await expect(source).not.toHaveAttribute('data-board-probe', 'retained');

    await center.getByRole('tab', { name: 'Board', exact: true }).click();
    await expect(page.getByTestId('flow-node-card')).toHaveCount(1);
    await page.getByTestId('flow-node-card').click();
    await expect(page.getByTestId('flow-node-panel').getByTestId('flow-node-title'))
        .toHaveValue('Review draft');

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

test('Tools panels follow the central area used, keeping both tabs selected', async ({ page }) => {
    await page.goto(FIRST);
    await showMarkdownEditor(page);
    await page.getByTestId('bar-toggle-center-2').click();
    await placeBoard(page, 'center-2');
    const first = page.getByTestId('tool-bar-center');
    const second = page.getByTestId('tool-bar-center-2');
    const open = async () => {
        await page.locator('.cms-top-banner .anticon-more').click();
        await page.locator('.ant-dropdown-menu:visible').first()
            .getByText('File optimizations…', { exact: true }).click();
        await expect(page.getByTestId('central-panel-file-optimizations')).toBeVisible();
    };

    await open();
    const panel = page.getByTestId('central-panel-file-optimizations');
    await expect(second.getByTestId('central-panel-file-optimizations')).toBeVisible();
    await expect(first.getByRole('tab', { name: 'Document', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(second.getByRole('tab', { name: 'Board', exact: true })).toHaveAttribute('aria-selected', 'true');
    await panel.getByRole('button', { name: 'Close', exact: true }).click();

    await first.locator('.cm-content').first().click();
    await open();
    await expect(first.getByTestId('central-panel-file-optimizations')).toBeVisible();
    await expect(second.getByTestId('central-panel-file-optimizations')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
});

test('a direct file URL selects Document with both side columns closed', async ({ page }) => {
    await page.goto(FIRST);

    await expect(page.getByTestId('tool-bar-center').getByRole('tab', { name: 'Document', exact: true }))
        .toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cms-document-area .configured-markdown-container')).toBeVisible();
    await expect(page.getByTestId('tool-bar-side-left')).toHaveCount(0);
    await expect(page.getByTestId('tool-bar-side-right')).toHaveCount(0);
});

test('direct board URLs select Board with both side columns closed; the bare prefix lists boards in Board', async ({ page }) => {
    await page.goto('boards/major');
    const center = page.getByTestId('tool-bar-center');
    await expect(center.getByRole('tab', { name: 'Board', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tool-bar-side-left')).toHaveCount(0);
    await expect(page.getByTestId('tool-bar-side-right')).toHaveCount(0);
    await expect(page.getByTestId('board-panel').getByTestId('flow-node-card')).toHaveCount(2);
    await expect(center.getByRole('tab', { name: 'Document', exact: true })).toBeVisible();

    await page.goto('boards');
    await expect(page.getByTestId('board-panel').getByTestId('boards-page')).toBeVisible();
    await expect(center.getByRole('tab', { name: 'Board', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tool-bar-side-left')).toHaveCount(0);
    await expect(page.getByTestId('tool-bar-side-right')).toHaveCount(0);
    await page.getByTestId('boards-page').getByTestId('board-row-major').getByRole('link').click();
    await expect(page.getByTestId('board-panel').getByTestId('flow-node-card')).toHaveCount(2);
});

test('board and file links preserve the selected navigation tab', async ({ page }) => {
    await page.goto(FIRST);
    await page.getByTestId('bar-toggle-left').click();

    const left = page.getByTestId('tool-bar-left');
    const center = page.getByTestId('tool-bar-center');
    const treeTab = left.getByRole('tab', { name: 'File tree', exact: true });
    const boardsTab = left.getByRole('tab', { name: 'Boards', exact: true });
    await treeTab.click();
    await page.getByRole('link', { name: 'Open board', exact: true }).click();

    await expect(center.getByRole('tab', { name: 'Board', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(treeTab).toHaveAttribute('aria-selected', 'true');
    await expect(boardsTab).toHaveAttribute('aria-selected', 'false');

    await boardsTab.click();
    await center.getByRole('tab', { name: 'Document', exact: true }).click();
    await page.getByRole('link', { name: 'Other notes', exact: true }).click();

    await expect(page).toHaveURL(new RegExp(SECOND.replace('.', '\\.') + '$'));
    await expect(center.getByRole('tab', { name: 'Document', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(boardsTab).toHaveAttribute('aria-selected', 'true');
    await expect(treeTab).toHaveAttribute('aria-selected', 'false');
});

test('both board lists sort alphabetically and mark the board kept open beside a document', async ({ page }) => {
    await serveBoard(page, [
        { ...board, id: 'zebra', slug: 'zebra', name: 'Zebra', updatedAt: '2026-10-20T00:00:00Z' },
        board,
        { ...board, id: 'alpha', slug: 'alpha', name: 'Alpha', updatedAt: '2026-09-01T00:00:00Z' },
    ]);
    await page.goto(FIRST);
    await page.getByTestId('tool-bar-center').getByRole('tab', { name: 'Board', exact: true }).click();
    await page.getByTestId('bar-toggle-left').click();
    await page.getByTestId('tool-bar-left').getByRole('tab', { name: 'Boards', exact: true }).click();

    const panel = page.getByTestId('boards-panel');
    for (const list of [page.getByTestId('boards-page'), panel]) {
        await expect(list.locator('[data-testid^="board-row-"] > a')).toHaveText([
            /^Alpha/, /^Major/, /^Zebra/,
        ]);
        await expect(list.locator('[aria-current="page"]')).toHaveCount(0);
    }

    const major = panel.getByTestId('board-row-major');
    const alpha = panel.getByTestId('board-row-alpha');
    await major.getByRole('link').click();
    await expect(major.getByRole('link')).toHaveAttribute('aria-current', 'page');
    const selectedBackground = await major.evaluate(row => getComputedStyle(row).backgroundColor);
    expect(selectedBackground).not.toBe(await alpha.evaluate(row => getComputedStyle(row).backgroundColor));
    await major.hover();
    await expect(major).toHaveCSS('background-color', selectedBackground);

    await page.getByTestId('tool-bar-center').getByRole('tab', { name: 'Document', exact: true }).click();
    await page.getByRole('link', { name: 'Other notes', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(SECOND.replace('.', '\\.') + '$'));
    await expect(page.getByTestId('tool-bar-left').getByRole('tab', { name: 'Boards', exact: true }))
        .toHaveAttribute('aria-selected', 'true');
    await expect(panel).toBeVisible();
    await expect(major.getByRole('link')).toHaveAttribute('aria-current', 'page');

    await alpha.getByRole('link').click();
    await expect(alpha.getByRole('link')).toHaveAttribute('aria-current', 'page');
    await expect(major.getByRole('link')).not.toHaveAttribute('aria-current');
});

test('idle board rows give their button space to the link and expose actions on hover or keyboard focus', async ({ page }) => {
    await page.goto('boards');
    const row = page.getByTestId('boards-page').getByTestId('board-row-major');
    const link = row.getByRole('link');
    const download = row.getByTestId('download-board-major');
    await expect(link).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(download).toBeHidden();
    const idleWidth = (await link.boundingBox())!.width;
    const idleHeight = (await row.boundingBox())!.height;

    await row.hover();
    await expect(download).toBeVisible();
    expect((await link.boundingBox())!.width).toBeLessThan(idleWidth);
    expect((await row.boundingBox())!.height).toBe(idleHeight);
    await page.mouse.move(0, 0);
    await expect(download).toBeHidden();
    expect((await link.boundingBox())!.width).toBe(idleWidth);

    await link.focus();
    await page.keyboard.press('Tab');
    await expect(download).toBeFocused();
    await expect(download).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(row.getByTestId('rename-board-major')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(row.getByTestId('delete-board-major')).toBeFocused();
});
