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

const review = { id: 'review', title: 'Review draft', type: 'human', tags: ['work'], spot: { x: 40, y: 80 } };
const choice = { id: 'choice', title: 'Choose path', type: 'gateway', tags: ['route'], spot: { x: 450, y: 80 } };
const writer = { id: 'writer', title: 'Write conclusion', type: 'ai', tags: ['work'], spot: { x: 40, y: 290 } };

// The test stack has no boards backend. These responses exercise the real board UI and HTTP client.
const serveBoard = async (page: Page, boards = [board], flowNodes = [review, choice]) => {
    await page.route('**/api/{hybridflow,agentic}/**', async route => {
        const url = new URL(route.request().url());
        const path = url.pathname.replace(/^\/api\/(?:hybridflow|agentic)/, '');
        if (path === '/changes') return route.abort();
        if (path === '/flow-nodes/review/board') return route.fulfill({ json: board });
        const nodes = flowNodes.map(node => ({ ...node, status: 'ready', body: '', settings: {}, onSuccess: {},
            createdAt: board.createdAt, updatedAt: board.updatedAt, revision: 1 }));
        const requested = boards.find(board => path === `/boards/${board.slug}` || path === `/boards/${board.id}`);
        const body = requested
            ? { board: requested, flowNodes: nodes, workflows: [], cursor: 0 }
            : path === '/boards' ? { boards: boards.filter(board => url.searchParams.has('archived') || !board.archived) }
            : { agents: [], runners: [] };
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
    await expect(page.getByTestId('tool-bar-right').getByTestId('flow-node-card')).toHaveCount(2);
    await expect(page.getByTestId('tool-bar-left').getByTestId('flow-node-title')).toHaveValue('Review draft');
});

test('reducing the board zoom shrinks its scrollable width and its cards together', async ({ page }) => {
    await serveBoard(page, [board], [review, { ...writer, spot: { x: 3500, y: 290 } }]);
    await page.goto('boards/major');
    const canvas = page.getByTestId('content-canvas');
    await expect(canvas.getByTestId('content-card')).toHaveCount(2);
    const card = canvas.getByTestId('content-card').first();
    const canvasWidth = () => canvas.evaluate(element => element.scrollWidth);
    const cardWidth = () => card.evaluate(element => element.getBoundingClientRect().width);
    const fullWidth = await canvasWidth();
    const fullCardWidth = await cardWidth();

    await page.getByTestId('board-filter').getByText('100%', { exact: true }).click({ timeout: 10000 });
    await page.locator('.ant-select-dropdown:visible').getByText('50%', { exact: true }).click({ timeout: 10000 });
    await expect.poll(async () => Math.abs(await canvasWidth() - fullWidth / 2)).toBeLessThanOrEqual(1);
    await expect.poll(cardWidth).toBeCloseTo(fullCardWidth / 2, 0);
});

test('task clicks and browser history keep the board mounted and update its editor', async ({ page }) => {
    await serveBoard(page, [board], [review, writer]);
    const boardReads: string[] = [];
    page.on('request', request => {
        const { pathname } = new URL(request.url());
        if (/^\/api\/hybridflow\/(boards\/[^/]+|flow-nodes\/[^/]+\/board)$/.test(pathname)
            && request.method() === 'GET') boardReads.push(pathname);
    });
    await page.goto('boards/major');
    const canvas = page.getByTestId('content-canvas');
    await canvas.evaluate(element => element.setAttribute('data-task-probe', 'retained'));
    const title = page.getByTestId('flow-node-title');

    for (const task of [review, writer]) {
        await page.getByTestId('flow-node-card').filter({ hasText: task.title }).click();
        await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}\\?board=${board.id}$`));
        await expect(title).toHaveValue(task.title);
    }

    await page.goBack();
    await expect(title).toHaveValue(review.title);
    await page.goForward();
    await expect(title).toHaveValue(writer.title);
    await page.goBack();
    await page.goBack();
    await expect(page).toHaveURL(/\/boards\/major$/);
    await expect(title).toHaveCount(0);
    await expect(canvas).toHaveAttribute('data-task-probe', 'retained');
    expect(boardReads).toEqual(['/api/hybridflow/boards/major']);
});

test('a task URL without a board opens its board and the editor beside it', async ({ page }) => {
    await page.goto('tasks/review');
    await expect(page.getByTestId('tool-bar-center').getByTestId('board-panel').getByTestId('flow-node-card'))
        .toHaveCount(2);
    await expect(page.getByTestId('tool-bar-right').getByTestId('flow-node-title')).toHaveValue('Review draft');
    await expect(page).toHaveURL(/\/tasks\/review$/);
    await expect(page).toHaveTitle(board.name);
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
    await expect(page).toHaveTitle(board.name);

    await page.goto('boards');
    await expect(page.getByTestId('board-panel').getByTestId('boards-page')).toBeVisible();
    await expect(page).toHaveTitle('Boards');
    await expect(center.getByRole('tab', { name: 'Board', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tool-bar-side-left')).toHaveCount(0);
    await expect(page.getByTestId('tool-bar-side-right')).toHaveCount(0);
    await page.getByTestId('boards-page').getByTestId('board-row-major').getByRole('link').click();
    await expect(page.getByTestId('board-panel').getByTestId('flow-node-card')).toHaveCount(2);
});

test('a board rename updates the browser title while the board is open', async ({ page }) => {
    const storedBoard = { ...board };
    await serveBoard(page, [storedBoard]);
    let announceRename!: () => void;
    const renamed = new Promise<void>(resolve => { announceRename = resolve; });
    await page.route(/\/api\/hybridflow\/changes\?/, async route => {
        await renamed;
        await route.fulfill({ json: {
            changes: [{ seq: 1, at: storedBoard.updatedAt, scope: 'board', kind: 'updated',
                board: storedBoard.id, revision: storedBoard.revision }],
            cursor: 1, more: false,
        } });
    }, { times: 1 });

    await page.goto('boards/major');
    await expect(page.getByTestId('flow-node-card')).toHaveCount(2);
    storedBoard.name = 'Release planning';
    storedBoard.revision++;
    announceRename();
    await expect(page).toHaveTitle(storedBoard.name);
    await expect(page).toHaveURL(/\/boards\/major$/);
});

test('board creation commands align and space their icons consistently', async ({ page }) => {
    await page.goto('boards/major');
    await page.getByTestId('content-canvas').click({ button: 'right', position: { x: 20, y: 20 } });

    const labels = page.getByRole('menu').getByTestId('new-flow-node');
    await expect(labels.filter({ hasText: 'New Parallel gateway' })).toBeVisible();
    await expect(labels.filter({ hasText: 'New Exclusive gateway' })).toBeVisible();
    await expect(labels.filter({ hasText: 'New Role' })).toBeVisible();
    const positions = await labels.evaluateAll(elements => elements.map(label => {
        const left = label.getBoundingClientRect().left;
        const icon = label.closest('[role="menuitem"]')!.firstElementChild!;
        return { left, gap: left - icon.getBoundingClientRect().right };
    }));
    expect(new Set(positions.map(({ left }) => left)).size).toBe(1);
    expect(new Set(positions.map(({ gap }) => gap)).size).toBe(1);
    expect(positions[0].gap).toBeGreaterThan(0);
});

test('gateway and event titles use the opaque board background', async ({ page }) => {
    const exclusive = { ...choice, id: 'exclusive', type: 'exclusive-gateway', title: 'Choose a route', spot: { x: 40, y: 80 } };
    const shutdown = { ...choice, id: 'shutdown', type: 'shutdown', title: 'Power off', spot: { x: 40, y: 280 } };
    await serveBoard(page, [board], [choice, exclusive, shutdown]);
    await page.goto('boards/major');

    const canvas = page.getByTestId('content-canvas');
    await expect(canvas.getByTestId('flow-node-card')).toHaveCount(3);

    for (const theme of ['light', 'dark', 'sober-light', 'sober-dark']) {
        await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
        const background = await canvas.evaluate(element => getComputedStyle(element).backgroundColor);
        expect(background).toMatch(/^rgb\(/);
        for (const { title } of [choice, exclusive, shutdown]) {
            await expect(canvas.getByText(title, { exact: true })).toHaveCSS('background-color', background);
        }
    }
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

test('board folders share expansion across lists and restore it after reload', async ({ page, request }) => {
    const major: typeof board & { folderId?: string } = { ...board };
    const old = { ...board, id: 'old', slug: 'old', name: 'Old board', archived: true };
    const folders: { id: string; name: string }[] = [];
    const folderId = '018e4710-986d-4399-b0d1-82b28e2022c2';
    await serveBoard(page, [major, old]);
    await page.route('**/api/hybridflow/folders/boards', async route => {
        if (route.request().method() === 'POST') {
            const folder = { id: folderId, name: route.request().postDataJSON().name };
            folders.push(folder);
            return route.fulfill({ status: 201, json: folder });
        }
        return route.fulfill({ json: { folders } });
    });
    await page.route('**/api/hybridflow/boards/major', async route => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        expect(route.request().headers()['if-match']).toBe(String(major.revision));
        major.folderId = route.request().postDataJSON().folderId || undefined;
        major.revision++;
        return route.fulfill({ json: major });
    });

    await page.goto('boards');
    const full = page.getByTestId('boards-page');
    await expect(full.getByTestId('board-row-major')).toBeVisible();
    await page.getByTestId('bar-toggle-left').click();
    await page.getByTestId('tool-bar-left').getByRole('tab', { name: 'Boards', exact: true }).click();
    const panel = page.getByTestId('boards-panel');
    const archived = panel.getByRole('switch', { name: 'Show archived boards' });
    await expect(panel.getByRole('button', { name: 'Import board' })).toHaveText('');
    await expect(panel.getByTestId('board-row-old')).toHaveCount(0);
    await archived.hover();
    await expect(page.getByRole('tooltip').filter({ hasText: 'Show archived boards' })).toBeVisible();
    await archived.click();
    await expect(panel.getByTestId('board-row-old')).toBeVisible();
    await archived.click();
    await expect(panel.getByTestId('board-row-old')).toHaveCount(0);

    await panel.getByRole('button', { name: 'Create board or folder' }).click();
    await page.getByRole('menuitem', { name: 'New folder' }).click();
    const dialog = page.getByRole('dialog', { name: 'New folder' });
    await dialog.getByRole('textbox', { name: 'Folder name' }).fill('Planning');
    const created = page.waitForResponse(response =>
        response.url().endsWith('/folders/boards') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    expect((await created).status()).toBe(201);
    await expect(dialog).toBeHidden();

    const branch = panel.getByRole('button', { name: 'Planning', exact: true });
    await expect(branch).toHaveAttribute('aria-expanded', 'false');
    await expect(full.getByRole('button', { name: 'Planning', exact: true })).toHaveAttribute('aria-expanded', 'false');

    const row = panel.getByTestId('board-row-major');
    await row.getByRole('link').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move board' }).hover();
    await page.getByRole('menuitem', { name: 'Planning', exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(full.getByTestId('board-row-major')).toHaveCount(0);
    await expect(page).toHaveURL(/\/boards$/);

    const savedExpansion = async () => {
        const response = await request.get(`${workerApi()}/config/dashboard-view-state.json`);
        return response.ok() ? (await response.json()).global.hybridflowBoardFolders : undefined;
    };
    await branch.press('Enter');
    await expect(panel.getByRole('group', { name: 'Planning' }).getByRole('link', { name: 'Major' }))
        .toHaveAttribute('href', '/dashboard/boards/major');
    await expect(full.getByRole('group', { name: 'Planning' }).getByTestId('board-row-major')).toBeVisible();
    await expect.poll(savedExpansion).toEqual([folderId]);
    await page.reload();
    await expect(branch).toHaveAttribute('aria-expanded', 'true');
    await expect(row).toBeVisible();

    await branch.click();
    await expect(row).toHaveCount(0);
    await expect.poll(savedExpansion).toEqual([]);
    await page.reload();
    await expect(branch).toHaveAttribute('aria-expanded', 'false');

    await branch.click();
    await row.getByRole('link').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move board' }).hover();
    await page.getByRole('menuitem', { name: 'Top level' }).click();
    await expect(panel.getByRole('group', { name: 'Planning' }).getByRole('link')).toHaveCount(0);
    await expect(row.getByRole('link')).toHaveAttribute('href', '/dashboard/boards/major');
});

test('both board lists open row actions by right-click and keyboard', async ({ page }) => {
    await page.route('**/api/hybridflow/folders/boards', route => route.fulfill({
        json: { folders: [{ id: 'planning', name: 'Planning' }] },
    }));
    await page.goto('boards');
    await page.getByTestId('bar-toggle-left').click();
    await page.getByTestId('tool-bar-left').getByRole('tab', { name: 'Boards', exact: true }).click();
    const items = page.getByRole('menu').getByRole('menuitem');
    const boardActions = ['Download', 'Rename', 'Move board', 'Delete'];

    for (const list of [page.getByTestId('boards-page'), page.getByTestId('boards-panel')]) {
        const row = list.getByTestId('board-row-major');
        const link = row.getByRole('link');
        const folder = list.getByRole('button', { name: 'Planning', exact: true });
        await row.hover();
        await expect(row.getByRole('button')).toHaveCount(0);
        await link.click({ button: 'right' });
        await expect(items).toHaveText(boardActions);
        await page.keyboard.press('Escape');
        await expect(items).toHaveCount(0);
        await expect(link).toBeFocused();

        await link.press('Shift+F10');
        await expect(items).toHaveText(boardActions);
        await folder.click({ button: 'right' });
        await expect(items).toHaveText(['New board', 'Rename', 'Delete']);
        await expect(folder).toHaveAttribute('aria-expanded', 'false');
        await items.filter({ hasText: 'Rename' }).click();
        const rename = page.getByRole('dialog', { name: 'Rename “Planning”' });
        await expect(rename.getByRole('textbox', { name: 'Folder name' })).toHaveValue('Planning');
        await rename.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(rename).toBeHidden();

        await folder.click({ button: 'right' });
        await items.filter({ hasText: 'Delete' }).click();
        const remove = page.getByRole('dialog', { name: 'Delete folder “Planning”?' });
        await remove.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(remove).toHaveCount(0);
        await expect(page).toHaveURL(/\/boards$/);
    }
});

test('creating a board from a collapsed folder opens the board and expands the folder in both lists', async ({ page }) => {
    const folder = { id: 'planning', name: 'Planning' };
    const boards: (typeof board & { folderId?: string })[] = [board];
    await serveBoard(page, boards);
    await page.route('**/api/hybridflow/folders/boards', route => route.fulfill({ json: { folders: [folder] } }));
    await page.route('**/api/hybridflow/boards', route => {
        if (route.request().method() !== 'POST') return route.fallback();
        expect(route.request().postDataJSON()).toEqual({ name: 'Release review', folderId: folder.id });
        const created = { ...board, id: 'release-review', slug: 'release-review', name: 'Release review', folderId: folder.id };
        boards.push(created);
        return route.fulfill({ status: 201, json: { board: created } });
    });

    await page.goto('boards');
    await page.getByTestId('bar-toggle-left').click();
    await page.getByTestId('tool-bar-left').getByRole('tab', { name: 'Boards', exact: true }).click();
    const full = page.getByTestId('boards-page');
    const panel = page.getByTestId('boards-panel');
    const branch = full.getByRole('button', { name: 'Planning', exact: true });
    await expect(branch).toHaveAttribute('aria-expanded', 'false');
    await branch.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New board' }).click();
    const create = page.getByRole('dialog', { name: 'New board in “Planning”' });
    await create.getByRole('textbox', { name: 'Board name' }).fill('Release review');
    await create.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page).toHaveURL(/\/boards\/release-review$/);
    await expect(panel.getByRole('group', { name: 'Planning' }).getByRole('link', { name: 'Release review' }))
        .toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(full.getByRole('group', { name: 'Planning' }).getByTestId('board-row-release-review')).toBeVisible();
});

test('board and folder names can be changed, with the board keeping its address', async ({ page }) => {
    const major = { ...board };
    const folder = { id: 'planning', name: 'Planning' };
    await serveBoard(page, [major]);
    await page.route('**/api/hybridflow/folders/boards', route => route.fulfill({ json: { folders: [folder] } }));
    await page.route('**/api/hybridflow/folders/boards/planning', async route => {
        expect(route.request().method()).toBe('PATCH');
        folder.name = route.request().postDataJSON().name;
        return route.fulfill({ json: folder });
    });
    await page.route('**/api/hybridflow/boards/major', async route => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        const { name } = route.request().postDataJSON();
        if (name === 'Taken') return route.fulfill({ status: 409 });
        major.name = name;
        return route.fulfill({ json: major });
    });

    await page.goto('boards');
    const list = page.getByTestId('boards-page');
    await list.getByTestId('board-row-major').getByRole('link').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename “Major”' });
    const name = rename.getByRole('textbox', { name: 'Board name' });
    await expect(name).toHaveValue('Major');
    await expect(name).toHaveAccessibleDescription('The board stays at /boards/major.');
    await name.fill('Taken');
    await name.press('Enter');
    await expect(rename.getByRole('alert')).toContainText('There is already a board called “Taken”.');
    await name.fill('Release review');
    await rename.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(list.getByRole('link', { name: /Release review/ })).toHaveAttribute('href', '/dashboard/boards/major');

    await list.getByRole('button', { name: 'Planning', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const folderName = page.getByRole('textbox', { name: 'Folder name' });
    await expect(folderName).toHaveValue('Planning');
    await folderName.fill('Delivery');
    await folderName.press('Enter');
    await expect(list.getByRole('button', { name: 'Delivery', exact: true })).toBeVisible();
});

test.describe('board rows with touch input', () => {
    test.use({ hasTouch: true });

    test('a long press opens actions and a tap opens the board', async ({ page }) => {
        await page.goto('boards');
        const link = page.getByTestId('boards-page').getByTestId('board-row-major').getByRole('link');
        await expect(link).toBeVisible();
        const box = (await link.boundingBox())!;
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
        });
        const download = page.getByRole('menuitem', { name: 'Download' });
        await expect(download).toBeVisible();
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect(download).toBeVisible();
        await expect(page).toHaveURL(/\/boards$/);

        await page.keyboard.press('Escape');
        await expect(download).toBeHidden();
        await link.tap();
        await expect(page).toHaveURL(/\/boards\/major$/);
    });
});
