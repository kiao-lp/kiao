import { test, expect, workerApi, resetViewState, flushViewState } from '../harness';

test.afterEach(async ({ page }) => {
    await flushViewState(page);
    await resetViewState();
});

test('edits and drags exclusive gateway routes in evaluation order', async ({ page, request }) => {
    const view = await request.put(`${workerApi()}/config/dashboard-view-state.json`, {
        data: {
            version: 1, folders: {}, files: {},
            global: { toolBars: {
                off: ['left'], width: {}, secondCentralArea: false,
                placement: { 'hybridflow-ui-flow-node': 'right' },
                selected: { right: 'hybridflow-ui-flow-node' },
            } },
        },
    });
    expect(view.ok()).toBeTruthy();

    const stamp = { createdAt: '2026-11-24T08:00:00Z', updatedAt: '2026-11-24T08:00:00Z', revision: 1 };
    const gateway = {
        id: 'decision', title: 'Decision', type: 'exclusive-gateway', status: 'ready', spot: { x: 80, y: 80 },
        onSuccess: { flowNodes: ['publish', 'review'] }, routes: [] as { condition: string; flowNode: string }[], ...stamp,
    };
    const board = {
        board: { id: 'routes', slug: 'routes', name: 'Routes', archived: false, ...stamp },
        flowNodes: [gateway,
            { id: 'publish', title: 'Publish', type: 'human', status: 'ready', spot: { x: 330, y: 50 }, ...stamp },
            { id: 'review', title: 'Review', type: 'human', status: 'ready', spot: { x: 330, y: 240 }, ...stamp },
            { id: 'other', title: 'Unlinked', type: 'human', status: 'ready', spot: { x: 330, y: 430 }, ...stamp },
        ],
        workflows: [], cursor: 0,
    };
    await page.route('**/api/{hybridflow,agentic}/**', async route => {
        const path = new URL(route.request().url()).pathname.replace(/^\/api\/(?:hybridflow|agentic)/, '');
        if (path === '/boards/routes/flow-nodes/decision' && route.request().method() === 'PATCH') {
            Object.assign(gateway, route.request().postDataJSON(), { revision: gateway.revision + 1 });
            await route.fulfill({ json: gateway });
        } else if (path === '/boards/routes') {
            await route.fulfill({ json: board });
        } else if (path === '/boards') {
            await route.fulfill({ json: { boards: [board.board] } });
        } else if (path === '/changes') {
            await route.abort();
        } else {
            await route.fulfill({ json: { agents: [], runners: [] } });
        }
    });

    await page.goto('boards/routes');
    const card = page.getByTestId('flow-node-card').filter({ hasText: gateway.title });
    await card.click();
    const panel = page.getByTestId('flow-node-panel');
    const add = panel.getByRole('button', { name: 'Add route' });
    const first = panel.getByRole('textbox', { name: 'Route 1 CEL condition' });
    const second = panel.getByRole('textbox', { name: 'Route 2 CEL condition' });
    await add.click();
    await first.fill('input.approved');
    await add.click();
    await second.fill('true');
    await panel.getByRole('combobox', { name: 'Route 2 successor' }).click();
    await expect(page.locator('.ant-select-item-option', { hasText: 'Unlinked' })).toHaveCount(0);
    await page.locator('.ant-select-item-option', { hasText: 'Review' }).click();
    await expect.poll(() => gateway.routes).toEqual([
        { condition: 'input.approved', flowNode: 'publish' }, { condition: 'true', flowNode: 'review' },
    ]);

    await panel.getByRole('button', { name: 'Reorder route 2' })
        .dragTo(panel.getByRole('button', { name: 'Reorder route 1' }));
    await expect.poll(() => gateway.routes).toEqual([
        { condition: 'true', flowNode: 'review' }, { condition: 'input.approved', flowNode: 'publish' },
    ]);
    await page.reload();
    await card.click();
    await expect(first).toHaveValue('true');
    await expect(second).toHaveValue('input.approved');
});
