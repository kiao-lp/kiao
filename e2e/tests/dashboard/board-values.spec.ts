import { test, expect, workerApi, resetViewState, flushViewState } from '../harness';

test.beforeEach(async ({ request }) => {
    const response = await request.put(`${workerApi()}/config/dashboard-view-state.json`, {
        data: {
            version: 1, folders: {}, files: {},
            global: { toolBars: {
                off: ['left'], width: {}, centralCount: 1,
                placement: { 'hybridflow-ui-flow-node': 'right' },
                selected: { right: 'hybridflow-ui-flow-node' },
            } },
        },
    });
    expect(response.ok()).toBeTruthy();
});
test.afterEach(async ({ page }) => {
    await flushViewState(page);
    await resetViewState();
});

test('shows value titles and edits shared JSON drafts in CodeMirror', async ({ page }) => {
    const stamp = { createdAt: '2026-10-25T08:00:00Z', updatedAt: '2026-10-25T08:00:00Z', revision: 1 };
    const value = {
        id: 'config', title: 'Configuration', type: 'value', status: 'ready',
        value: { endpoint: 'local' }, spot: { x: 80, y: 80 }, ...stamp,
    };
    const board = {
        board: { id: 'values', slug: 'values', name: 'Values', archived: false, ...stamp },
        flowNodes: [value], flowNodeClasses: [], workflows: [], workflowClasses: [], cursor: 0,
    };

    // The harness has no boards backend; keep writes at its HTTP boundary.
    await page.route('**/api/hybridflow/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/api/hybridflow', '');
        if (path === '/boards/values/flow-nodes/config' && route.request().method() === 'PATCH') {
            Object.assign(value, route.request().postDataJSON(), { revision: value.revision + 1 });
            await route.fulfill({ json: value });
        } else if (path === '/boards/values') {
            await route.fulfill({ json: board });
        } else if (path === '/boards') {
            await route.fulfill({ json: { boards: [board.board] } });
        } else if (path === '/changes') {
            await route.abort();
        } else {
            await route.fulfill({ json: { agents: [], runners: [], flowNodeClasses: [], workflowClasses: [] } });
        }
    });

    await page.goto('boards/values');
    const card = page.getByTestId('flow-node-value-card');
    await expect(card).toHaveText('Configuration');
    await expect(card.getByRole('img', { name: 'Value', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Copy JSON' })).toHaveCount(0);

    await card.click();
    const panel = page.getByTestId('flow-node-panel');
    const source = panel.getByRole('textbox', { name: 'Value JSON', exact: true });
    await expect(source).toContainText('"endpoint"');
    await expect(panel.locator('.cm-lineNumbers')).toBeVisible();
    const compact = '{"endpoint":"local","enabled":true}';
    await source.fill(compact);
    await expect.poll(() => value.value).toEqual(JSON.parse(compact));
    await expect(source).toHaveText(compact);

    await source.fill('{"endpoint":');
    await expect(panel.getByRole('alert')).toHaveText('Invalid JSON');
    await panel.getByRole('textbox', { name: 'Value title' }).fill('Settings');
    await expect.poll(() => value.title).toBe('Settings');
    expect(value.value).toEqual(JSON.parse(compact));
    await expect(source).toHaveText('{"endpoint":');

    await panel.getByTestId('expand-flow-node').click();
    const editor = page.getByTestId('central-panel-flow-node-editor');
    const expandedSource = editor.getByRole('textbox', { name: 'Value JSON', exact: true });
    await expect(expandedSource).toHaveText('{"endpoint":');
    await expect(editor.getByRole('alert')).toHaveText('Invalid JSON');
    const edited = '{"endpoint":"updated"}';
    await expandedSource.fill(edited);
    await expect.poll(() => value.value).toEqual(JSON.parse(edited));
    await expect(editor.getByRole('alert')).toHaveCount(0);
    await expect(source).toHaveText(edited);
    await editor.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(card).toHaveText('Settings');

    await page.reload();
    await expect(card).toHaveText('Settings');
    await card.dblclick();
    await expect(expandedSource).toContainText('"updated"');
});
