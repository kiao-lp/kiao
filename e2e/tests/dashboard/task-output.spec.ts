import { test, expect, resetViewState, workerApi } from '../harness';

const TEMPLATE_PATH = 'kiao-user-config/flow-node-templates/Toolbar check.temp.md';

test.afterEach(async ({ request }) => {
    await request.delete(`${workerApi()}/delete?path=${encodeURIComponent(TEMPLATE_PATH)}`);
    await resetViewState();
});

test('task tabs retain their drafts beside the template menu and archive action', async ({ page, request }) => {
    const template = [
        '# Toolbar check', '', '## Root', '', '### textTemplate', '',
        '```text', '# ${flowNodeTitle}', '', '${flowNodeDescription}', '',
        'Prepared from the toolbar.', '```',
    ].join('\n');
    const response = await request.put(`${workerApi()}/update?path=${encodeURIComponent(TEMPLATE_PATH)}`, {
        multipart: { file: { name: 'Toolbar check.temp.md', mimeType: 'text/markdown', buffer: Buffer.from(template) } },
    });
    expect(response.ok()).toBeTruthy();

    const stamp = { createdAt: '2026-11-11T08:00:00Z', updatedAt: '2026-11-11T08:00:00Z', revision: 1 };
    const task = {
        id: 'writer', title: 'Write a greeting', type: 'ai', status: 'ready',
        body: 'Write a greeting.', output: { message: 'Hello' },
        spot: { x: 80, y: 80 }, ...stamp,
    };
    const board = {
        board: { id: 'task-output', slug: 'task-output', name: 'Task output', archived: false, ...stamp },
        flowNodes: [task, {
            id: 'reviewer', title: 'Review the greeting', type: 'human', status: 'done',
            body: 'Review it.', output: 'Approved', spot: { x: 450, y: 80 }, ...stamp,
        }],
        flowNodeClasses: [], workflows: [], workflowClasses: [], cursor: 0,
    };
    let usageReads = 0;
    let costUsdMicros = 1_230_000;
    await page.route('**/api/hybridflow/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/api/hybridflow', '');
        if (path === '/boards/task-output/flow-nodes/writer/usage') {
            usageReads += 1;
            await route.fulfill({ json: {
                reports: 2, inputTokens: 12400, outputTokens: 3100,
                cacheReadTokens: 8000, cacheWriteTokens: 1200, reasoningTokens: 500,
                costUsdMicros,
            } });
        } else if (path === '/boards/task-output/flow-nodes/writer' && route.request().method() === 'PATCH') {
            Object.assign(task, route.request().postDataJSON(), { revision: task.revision + 1 });
            await route.fulfill({ json: task });
        } else if (path === '/boards/task-output') {
            await route.fulfill({ json: board });
        } else if (path === '/boards') {
            await route.fulfill({ json: { boards: [board.board] } });
        } else if (path === '/changes') {
            await route.abort();
        } else {
            await route.fulfill({ json: { agents: [], runners: [], schemaValues: [], flowNodeClasses: [], workflowClasses: [] } });
        }
    });

    await page.goto('boards/task-output');
    await page.locator('[data-flow-node-id="writer"]').click();
    const panel = page.getByTestId('flow-node-panel');
    const specTab = panel.getByRole('tab', { name: 'Spec', exact: true });
    const optionsTab = panel.getByRole('tab', { name: 'Options', exact: true });
    const resultTab = panel.getByRole('tab', { name: 'Result', exact: true });
    const templates = panel.getByRole('button', { name: 'Instantiate template' });
    const archive = panel.getByRole('button', { name: 'Archive node' });
    await expect(panel.getByRole('button', { name: 'Delete node' })).toHaveCount(0);
    await expect(panel.getByRole('combobox', { name: 'Template', exact: true })).toHaveCount(0);
    await expect(specTab).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByTestId('flow-node-result')).toHaveCount(0);
    const specBox = (await specTab.boundingBox())!;
    const optionsBox = (await optionsTab.boundingBox())!;
    const resultBox = (await resultTab.boundingBox())!;
    const templateBox = (await templates.boundingBox())!;
    const archiveBox = (await archive.boundingBox())!;
    expect(specBox.x + specBox.width).toBeLessThanOrEqual(optionsBox.x);
    expect(optionsBox.x + optionsBox.width).toBeLessThanOrEqual(resultBox.x);
    expect(resultBox.x + resultBox.width).toBeLessThanOrEqual(templateBox.x);
    expect(templateBox.x + templateBox.width).toBeLessThanOrEqual(archiveBox.x);
    expect(Math.abs(templateBox.y - archiveBox.y)).toBeLessThan(1);
    expect(Math.abs(resultBox.y - archiveBox.y)).toBeLessThan(10);
    expect(usageReads).toBe(0);

    const source = panel.locator('.cm-content');
    const outputType = panel.getByTestId('flow-node-output-type');
    await expect(outputType).toBeVisible();
    const descriptionBox = (await source.boundingBox())!;
    const outputTypeBox = (await outputType.boundingBox())!;
    const criteriaBox = (await panel.getByTestId('flow-node-criteria').boundingBox())!;
    expect(descriptionBox.y + descriptionBox.height).toBeLessThanOrEqual(outputTypeBox.y);
    expect(outputTypeBox.y + outputTypeBox.height).toBeLessThanOrEqual(criteriaBox.y);
    await source.fill('Draft greeting instructions');
    await expect.poll(() => task.body).toBe('Draft greeting instructions');
    await source.evaluate(element => { element.setAttribute('data-task-draft', 'retained'); });

    await optionsTab.click();
    await expect(source).toBeHidden();
    await expect(panel.getByLabel('Working directory')).toBeHidden();
    await expect(outputType).toBeHidden();

    await resultTab.click();
    const costs = panel.getByTestId('flow-node-costs');
    await expect(costs).toHaveText('$1.23 · 12.4K in / 3.1K out');
    const initialReads = usageReads;
    await expect(source).toBeHidden();
    await expect(panel.getByTestId('flow-node-output-type')).toBeHidden();
    await expect(archive).toBeVisible();
    await expect(templates).toBeVisible();
    const result = panel.getByTestId('flow-node-result');
    await result.locator('summary').click();
    await expect(result.locator('pre')).toBeVisible();
    expect(JSON.parse((await result.locator('pre').textContent())!)).toEqual({ message: 'Hello' });
    await costs.hover();
    await expect(page.getByRole('tooltip')).toContainText('Cache read: 8,000');
    await expect(page.getByRole('tooltip')).toContainText('Reasoning: 500');

    await specTab.click();
    await expect(source).toBeVisible();
    await expect(source).toHaveText('Draft greeting instructions');
    await expect(source).toHaveAttribute('data-task-draft', 'retained');
    await expect(result).toHaveCount(0);
    costUsdMicros = 2_460_000;
    await resultTab.click();
    await expect(costs).toHaveText('$2.46 · 12.4K in / 3.1K out');
    expect(usageReads).toBeGreaterThan(initialReads);

    await expect(templates).toBeEnabled();
    await templates.click();
    for (const name of ['AI', 'Human', 'Toolbar check']) {
        await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
    }
    await page.getByRole('menuitem', { name: 'Toolbar check', exact: true }).click();
    const instantiation = page.getByTestId('central-panel-template-instantiation');
    await expect(instantiation).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Toolbar check', exact: true })).toBeHidden();
    const preview = instantiation.getByTestId('template-preview');
    await expect(preview).toContainText('Draft greeting instructions');
    await expect(preview).toContainText('Prepared from the toolbar.');
    await instantiation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(instantiation).toHaveCount(0);
    expect(task.body).toBe('Draft greeting instructions');
    await expect(resultTab).toHaveAttribute('aria-selected', 'true');

    await templates.click();
    await page.getByRole('menuitem', { name: 'Toolbar check', exact: true }).click();
    await instantiation.getByRole('button', { name: 'Instantiate', exact: true }).click();
    await expect(instantiation).toHaveCount(0);
    const description = '# Write a greeting\n\nDraft greeting instructions\n\nPrepared from the toolbar.';
    await expect.poll(() => task.body.trim()).toBe(description);
    await specTab.click();
    await expect(source).toContainText('Prepared from the toolbar.');
    await expect(source).toHaveAttribute('data-task-draft', 'retained');
    await page.reload();
    await page.locator('[data-flow-node-id="writer"]').click();
    await expect(source).toContainText('Prepared from the toolbar.');

    await page.locator('[data-flow-node-id="reviewer"]').click();
    await expect(specTab).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByTestId('flow-node-title')).toHaveValue('Review the greeting');
    await resultTab.click();
    await expect(costs).toHaveCount(0);
    await result.locator('summary').click();
    await expect(result.locator('pre')).toHaveText('"Approved"');

    await page.locator('[data-flow-node-id="writer"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Delete node$/ }).click();
    const deletion = page.getByRole('dialog');
    await expect(deletion).toContainText('Delete “Write a greeting”?');
    await deletion.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('[data-flow-node-id="writer"]')).toBeVisible();
});
