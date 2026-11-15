import { test, expect, resetViewState } from '../harness';
import type { Page, Route } from '@playwright/test';

const stamp = { createdAt: '2026-11-14T08:00:00Z', updatedAt: '2026-11-14T08:00:00Z', revision: 1 };

async function serveTask(page: Page, { typed = false, failSave = false } = {}) {
    const human = {
        id: 'review', title: 'Review the result', type: 'human', status: 'todo',
        body: 'Check the result.', criteria: [{ id: 'checked', text: 'Result checked' }],
        outputType: typed ? 'schema-1' : '', onSuccess: { flowNode: 'writer', mode: 'end' },
        spot: { x: 80, y: 80 }, ...stamp,
    };
    const ai = {
        id: 'writer', title: 'Write the conclusion', type: 'ai', status: 'ready', body: 'Use {{input}}.',
        settings: { agent: 'agent-1', effort: 'high', permission: 'bypassPermissions', folder: '/' },
        spot: { x: 440, y: 80 }, ...stamp,
    };
    const board = {
        board: { id: 'human-task', slug: 'human-task', name: 'Human task', archived: false, ...stamp },
        flowNodes: [human, ai], flowNodeClasses: [], workflows: [], workflowClasses: [], cursor: 0,
    };
    const plays: unknown[] = [];
    const savedOutputs: unknown[] = [];
    let pendingSave: Route | null = null;
    await page.route('**/api/hybridflow/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/api/hybridflow', '');
        if (path === '/boards/human-task/flow-nodes/review' && route.request().method() === 'PATCH') {
            const patch = route.request().postDataJSON();
            if (patch.status === 'done') {
                if (failSave) return route.fulfill({ status: 500, json: { error: 'Save failed' } });
                pendingSave = route;
                return;
            }
            Object.assign(human, patch);
            return route.fulfill({ json: human });
        }
        if (path === '/boards/human-task') return route.fulfill({ json: board });
        if (path === '/boards') return route.fulfill({ json: { boards: [board.board] } });
        if (path === '/changes') return route.abort();
        return route.fulfill({ json: {
            agents: [{ id: 'agent-1', name: 'Writer', harness: 'claude', model: 'opus',
                published: { id: 'version-1', number: 1, harness: 'claude', model: 'opus', ...stamp }, ...stamp }],
            runners: [], flowNodeClasses: [], workflowClasses: [],
            schemaValues: typed ? [{ id: 'schema-1', title: 'Answer', value: {
                type: 'object', properties: { approved: { type: 'boolean' } }, required: ['approved'],
            } }] : [],
        } });
    });
    await page.route('**/hybridflow-runner/chain-runs/play', async route => {
        savedOutputs.push(structuredClone(human));
        plays.push(route.request().postDataJSON());
        await route.fulfill({ json: { run: null } });
    });
    await page.goto('boards/human-task');
    await page.getByRole('button', { name: 'Work on this task', exact: true }).click();
    await expect(page.getByTestId('work-on-task')).toBeVisible();

    return {
        plays, savedOutputs,
        pending: () => pendingSave !== null,
        save: async () => {
            const route = pendingSave!;
            Object.assign(human, route.request().postDataJSON());
            pendingSave = null;
            await route.fulfill({ json: human });
        },
    };
}

test.afterEach(resetViewState);

test('human task zoom follows the top panel and starts its successor after saving', async ({ page }) => {
    const task = await serveTask(page);
    const panel = page.getByTestId('work-on-task');
    const strip = page.getByTestId('tool-bar-center').locator(':scope > .ant-tabs > .ant-tabs-nav');
    const zoom = strip.locator('.ant-select');
    const output = panel.getByRole('textbox', { name: 'Output', exact: true });
    const instructions = panel.locator('p').filter({ hasText: 'Check the result.' });
    const submit = panel.getByRole('button', { name: 'Submit', exact: true });
    await expect(strip.getByTestId('board-filter')).toHaveCount(0);
    await expect(zoom).toHaveCount(1);
    const initialText = (await instructions.boundingBox())!;
    const initialOutput = (await output.boundingBox())!;
    const initialSubmit = (await submit.boundingBox())!;

    await zoom.click();
    await page.locator('.ant-select-dropdown .ant-select-item-option').getByText('150%', { exact: true }).click();
    await expect(panel.getByTestId('work-on-task-content')).toHaveCSS('zoom', '1.5');
    expect((await instructions.boundingBox())!.height / initialText.height).toBeCloseTo(1.5, 1);
    expect((await output.boundingBox())!.height / initialOutput.height).toBeCloseTo(1.5, 1);
    expect((await submit.boundingBox())!.height).toBeCloseTo(initialSubmit.height, 1);
    await output.fill('Approved');

    await page.locator('.cms-top-banner .anticon-more').click();
    await page.locator('.ant-dropdown-menu:visible').first().getByText('File optimizations…', { exact: true }).click();
    const overlay = page.getByTestId('central-panel-file-optimizations');
    await expect(overlay).toBeVisible();
    await expect(zoom).toHaveCount(0);
    await expect(panel).toBeHidden();
    await overlay.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(panel).toBeVisible();
    await expect(strip).toContainText('150%');
    await expect(output).toHaveValue('Approved');
    await strip.getByRole('button', { name: 'Reset zoom to 100%' }).click();
    await expect(panel.getByTestId('work-on-task-content')).toHaveCSS('zoom', '1');

    await submit.click();
    await expect.poll(task.pending).toBe(true);
    expect(task.plays).toEqual([]);
    await expect(panel).toBeVisible();
    await task.save();
    await expect.poll(() => task.plays).toEqual([
        { path: 'human-task', flowNodeId: 'writer', name: expect.stringMatching(/^Started /) },
    ]);
    expect(task.savedOutputs).toEqual([expect.objectContaining({ status: 'done', output: 'Approved' })]);
    await expect(panel).toHaveCount(0);
    await expect(strip.getByTestId('board-filter')).toBeVisible();
});

test('a failed human submission keeps the form and draft available', async ({ page }) => {
    const task = await serveTask(page, { failSave: true });
    const panel = page.getByTestId('work-on-task');
    await panel.getByRole('textbox', { name: 'Output', exact: true }).fill('Keep this draft');
    await panel.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('The task could not be saved');
    await expect(panel.getByRole('textbox', { name: 'Output', exact: true })).toHaveValue('Keep this draft');
    expect(task.plays).toEqual([]);
});

test('human JSON output zooms and validates before starting the next task', async ({ page }) => {
    const task = await serveTask(page, { typed: true });
    const panel = page.getByTestId('work-on-task');
    const output = panel.getByTestId('work-on-task-output').locator('.cm-content');
    const strip = page.getByTestId('tool-bar-center').locator(':scope > .ant-tabs > .ant-tabs-nav');
    await output.fill('{"approved": false}');
    const initial = (await output.locator('.cm-line').first().boundingBox())!;
    await strip.locator('.ant-select').click();
    await page.locator('.ant-select-dropdown .ant-select-item-option').getByText('150%', { exact: true }).click();
    expect((await output.locator('.cm-line').first().boundingBox())!.height / initial.height).toBeCloseTo(1.5, 1);

    await output.fill('{"approved": "yes"}');
    await panel.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(panel.getByRole('alert')).toBeVisible();
    expect(task.pending()).toBe(false);
    expect(task.plays).toEqual([]);

    await output.fill('{"approved": true}');
    await panel.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect.poll(task.pending).toBe(true);
    await task.save();
    await expect.poll(() => task.plays.length).toBe(1);
    expect(task.savedOutputs).toEqual([expect.objectContaining({ status: 'done', output: { approved: true } })]);
});
