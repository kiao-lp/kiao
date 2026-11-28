import { test, expect, workerApi, resetViewState, flushViewState } from '../harness';

test.afterEach(async ({ page }) => {
    await flushViewState(page);
    await resetViewState();
});

const events = [{
    name: 'Bitbucket PR Status', type: 'bitbucket-pr-status',
    idLabel: 'Pull request ID', idField: 'pullRequestId', statusField: 'pullRequestStatus',
    id: 'team/repo#42', target: 'MERGED', reference: '{{input.pullRequestId}}',
}, {
    name: 'Bitbucket Commit Status', type: 'bitbucket-commit-status',
    idLabel: 'Commit ID', idField: 'commitId', statusField: 'commitStatus',
    id: 'team/repo@a1b2c3d', target: 'SUCCESSFUL', reference: '{{currentWorkflow.commitId}}',
}];

events.forEach(event => test(`configures ${event.name} and restores the wait when reopening the board`, async ({ page, request }) => {
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
    let node: { id: string; type: string; onSuccess?: { flowNode: string }; [field: string]: unknown } | undefined;
    const successor = { id: 'publish', type: 'human', title: 'Publish', status: 'ready', spot: { x: 400, y: 250 }, ...stamp };
    const board = {
        board: { id: 'pull-requests', slug: 'pull-requests', name: 'Pull requests', archived: false, ...stamp },
        workflows: [], cursor: 0,
    };
    await page.route('**/api/{hybridflow,agentic}/**', async route => {
        const path = new URL(route.request().url()).pathname.replace(/^\/api\/(?:hybridflow|agentic)/, '');
        if (path === '/boards/pull-requests/flow-nodes' && route.request().method() === 'POST') {
            node = { ...route.request().postDataJSON().flowNodes[0], status: 'ready', ...stamp };
            await route.fulfill({ json: { flowNodes: [node] } });
        } else if (node && path === `/boards/pull-requests/flow-nodes/${node.id}` && route.request().method() === 'PATCH') {
            Object.assign(node, route.request().postDataJSON());
            await route.fulfill({ json: node });
        } else if (path === '/boards/pull-requests') {
            await route.fulfill({ json: { ...board, flowNodes: node ? [node, successor] : [successor] } });
        } else if (path === '/boards') {
            await route.fulfill({ json: { boards: [board.board] } });
        } else if (path === '/changes') {
            await route.abort();
        } else {
            await route.fulfill({ json: { agents: [], runners: [] } });
        }
    });

    await page.goto('boards/pull-requests');
    await page.getByTestId('content-canvas').click({ button: 'right', position: { x: 50, y: 50 } });
    await page.getByRole('menuitem', { name: `New ${event.name}` }).click();
    await expect.poll(() => node?.type).toBe(event.type);
    const card = page.getByTestId('flow-node-card').and(page.locator('[data-shape="circle"]'));
    await expect(card).toHaveAttribute('data-shape', 'circle');
    await expect(card.getByTestId('play-flow-node')).toHaveCount(0);

    const panel = page.getByTestId('flow-node-panel');
    const id = panel.getByRole('textbox', { name: event.idLabel });
    await id.fill(event.id);
    await id.press('Enter');
    await panel.getByRole('combobox', { name: 'Target status' }).click();
    await page.locator('.ant-select-item-option', { hasText: event.target }).click();
    await expect.poll(() => [node?.[event.idField], node?.[event.statusField]]).toEqual([event.id, event.target]);
    await panel.getByRole('combobox', { name: 'On success' }).click();
    await page.locator('.ant-select-item-option', { hasText: 'Publish' }).click();
    await expect.poll(() => node?.onSuccess?.flowNode).toBe(successor.id);

    await page.reload();
    await card.click();
    await expect(id).toHaveValue(event.id);
    await expect(panel.getByText(event.target, { exact: true })).toBeVisible();
    await expect(panel.getByTestId('flow-node-success').getByText('Publish', { exact: true })).toBeVisible();
    await expect(card.getByTestId('play-flow-node')).toBeVisible();

    await id.fill(event.reference);
    await id.press('Enter');
    await panel.getByRole('combobox', { name: 'Target status' }).click();
    await page.locator('.ant-select-item-option', { hasText: 'Use a value reference' }).click();
    const target = panel.getByRole('textbox', { name: 'Target status reference' });
    const targetReference = '{{currentWorkflow.targetStatus}}';
    await target.fill(targetReference);
    await target.press('Enter');
    await expect.poll(() => [node?.[event.idField], node?.[event.statusField]])
        .toEqual([event.reference, targetReference]);

    await page.reload();
    await card.click();
    await expect(id).toHaveValue(event.reference);
    await expect(target).toHaveValue(targetReference);
    await expect(card.getByTestId('play-flow-node')).toBeVisible();
}));
