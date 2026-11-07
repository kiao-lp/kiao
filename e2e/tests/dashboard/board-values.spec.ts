import { test, expect, workerApi, resetViewState, flushViewState } from '../harness';

test.beforeEach(async ({ request }) => {
    const response = await request.put(`${workerApi()}/config/dashboard-view-state.json`, {
        data: {
            version: 1, folders: {}, files: {},
            global: { toolBars: {
                off: ['left'], width: {}, secondCentralArea: false,
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

test('types a value by a saved JSON Schema value', async ({ page }) => {
    const stamp = { createdAt: '2026-10-25T08:00:00Z', updatedAt: '2026-10-25T08:00:00Z', revision: 1 };
    const schemaId = '11111111-1111-1111-1111-111111111111';
    const schema = {
        id: schemaId, title: 'Person', type: 'value', status: 'ready',
        value: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        spot: { x: 80, y: 80 }, ...stamp,
    } as Record<string, unknown>;
    const typed = {
        id: '22222222-2222-2222-2222-222222222222', title: 'Ada', type: 'value', status: 'ready',
        value: { name: 'Ada' }, spot: { x: 80, y: 320 }, ...stamp,
    } as Record<string, unknown>;
    const nodes: Record<string, Record<string, unknown>> = { [schemaId]: schema, [String(typed.id)]: typed };
    const board = {
        board: { id: 'typed', slug: 'typed', name: 'Typed', archived: false, ...stamp },
        flowNodes: [schema, typed], flowNodeClasses: [], workflows: [], workflowClasses: [], cursor: 0,
    };
    await page.route('**/api/hybridflow/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/api/hybridflow', '');
        const patch = path.match(/^\/boards\/typed\/flow-nodes\/(.+)$/);
        if (patch && route.request().method() === 'PATCH') {
            const node = nodes[patch[1]];
            Object.assign(node, route.request().postDataJSON(), { revision: Number(node.revision) + 1 });
            await route.fulfill({ json: node });
        } else if (path === '/boards/typed') {
            await route.fulfill({ json: board });
        } else if (path === '/boards') {
            await route.fulfill({ json: { boards: [board.board] } });
        } else if (path === '/changes') {
            await route.abort();
        } else {
            await route.fulfill({ json: { agents: [], runners: [], flowNodeClasses: [], workflowClasses: [] } });
        }
    });

    await page.goto('boards/typed');
    const cards = page.getByTestId('flow-node-value-card');
    await cards.filter({ hasText: 'Person' }).click();
    const panel = page.getByTestId('flow-node-panel');
    const typeSelect = panel.getByTestId('flow-node-value-type');
    await expect(typeSelect).toContainText('No type');
    await typeSelect.click();
    await page.locator('.ant-select-item-option', { hasText: 'JSON Schema' }).click();
    await expect.poll(() => schema.valueType).toBe('json-schema');

    const source = panel.getByRole('textbox', { name: 'Value JSON', exact: true });
    await source.fill('{"type":"object","properties":{"name":{"type":"strng"}}}');
    await expect(panel.locator('.cm-lintRange-error').first()).toBeVisible();
    await source.fill('{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}');
    await expect(panel.locator('.cm-lintRange-error')).toHaveCount(0);
    await expect.poll(() => schema.value).toEqual(
        { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] });

    await cards.filter({ hasText: 'Ada' }).click();
    await expect(panel.getByRole('textbox', { name: 'Value title' })).toHaveValue('Ada');
    const typedSelect = panel.getByTestId('flow-node-value-type');
    await typedSelect.click();
    await page.locator('.ant-select-item-option', { hasText: 'Person' }).click();
    await expect.poll(() => typed.valueType).toBe(schemaId);

    await source.fill('{"name":42}');
    await expect(panel.locator('.cm-lintRange-error').first()).toBeVisible();
    await source.fill('{"name":"Ada"}');
    await expect(panel.locator('.cm-lintRange-error')).toHaveCount(0);

    await page.reload();
    await cards.filter({ hasText: 'Ada' }).click();
    await expect(panel.getByTestId('flow-node-value-type')).toContainText('Person');
});

test('selects an AI output schema from another board in both editors', async ({ page }) => {
    const stamp = { createdAt: '2026-10-26T08:00:00Z', updatedAt: '2026-10-26T08:00:00Z', revision: 1 };
    const schemaId = '11111111-1111-1111-1111-111111111111';
    const task: Record<string, unknown> = {
        id: 'writer', title: 'Write a greeting', type: 'ai', status: 'ready',
        body: 'Write a greeting.', spot: { x: 80, y: 80 }, ...stamp,
    };
    const board = {
        board: { id: 'tasks', slug: 'tasks', name: 'Tasks', archived: false, ...stamp },
        flowNodes: [task], flowNodeClasses: [], workflows: [], workflowClasses: [], cursor: 0,
    };
    await page.route('**/api/hybridflow/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/api/hybridflow', '');
        if (path === '/schema-values') {
            await route.fulfill({ json: { schemaValues: [{
                id: schemaId, title: 'Greeting', boardName: 'Shared schemas', boardSlug: 'shared-schemas',
                value: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
            }] } });
        } else if (path === '/boards/tasks/flow-nodes/writer' && route.request().method() === 'PATCH') {
            Object.assign(task, route.request().postDataJSON(), { revision: Number(task.revision) + 1 });
            await route.fulfill({ json: task });
        } else if (path === '/boards/tasks') {
            await route.fulfill({ json: board });
        } else if (path === '/boards') {
            await route.fulfill({ json: { boards: [board.board] } });
        } else if (path === '/changes') {
            await route.abort();
        } else {
            await route.fulfill({ json: { agents: [], runners: [], flowNodeClasses: [], workflowClasses: [] } });
        }
    });
    await page.goto('boards/tasks');
    await page.locator('[data-flow-node-id="writer"]').click();
    const panel = page.getByTestId('flow-node-panel');
    const select = panel.getByTestId('flow-node-output-type');
    await expect(select).toContainText('No output type');
    await select.click();
    await page.locator('.ant-select-item-option', { hasText: 'Shared schemas / Greeting' }).click();
    await expect.poll(() => task.outputType).toBe(schemaId);
    await panel.getByTestId('expand-flow-node').click();
    const editor = page.getByTestId('central-panel-flow-node-editor');
    await expect(editor.getByTestId('flow-node-output-type')).toContainText('Shared schemas / Greeting');
    await editor.getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();
    await page.locator('[data-flow-node-id="writer"]').dblclick();
    await expect(editor.getByTestId('flow-node-output-type')).toContainText('Shared schemas / Greeting');
    await editor.getByTestId('flow-node-output-type').click();
    await page.locator('.ant-select-item-option', { hasText: 'No output type' }).click();
    await expect.poll(() => task.outputType).toBe('');
    await expect(select).toContainText('No output type');
});
