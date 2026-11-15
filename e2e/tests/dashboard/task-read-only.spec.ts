import { test, expect, resetViewState } from '../harness';
import type { Locator } from '@playwright/test';

test.afterEach(resetViewState);

test('AI task fields are read-only outside Draft and Ready in the panel', async ({ page }) => {
    const stamp = { createdAt: '2026-10-31T08:00:00Z', updatedAt: '2026-10-31T08:00:00Z', revision: 1 };
    const agent = {
        id: 'reviewer', name: 'Reviewer', harness: 'claude', model: 'opus', ...stamp,
        published: { agentId: 'reviewer', version: 1, name: 'Reviewer', harness: 'claude', model: 'opus',
            publishedAt: stamp.createdAt },
    };
    const task = {
        id: 'review', title: 'Review the change', type: 'ai', status: 'done',
        body: '## Review instructions\n\nRead the diff carefully.',
        criteria: [{ id: 'criterion-1', text: 'All changes are reviewed.' }],
        settings: { agent: 'reviewer', effort: 'high', permission: 'manual', folder: '/' },
        onSuccess: { compact: true, mode: 'end' },
        spot: { x: 100, y: 100 }, ...stamp,
    };
    const board = {
        board: { id: 'task-editing', slug: 'task-editing', name: 'Task editing', archived: false, ...stamp },
        flowNodes: [task], flowNodeClasses: [], workflows: [], workflowClasses: [], cursor: 0,
    };
    const patches: Record<string, unknown>[] = [];
    await page.route('**/api/hybridflow/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/api/hybridflow', '');
        if (path === '/boards/task-editing/flow-nodes/review' && route.request().method() === 'PATCH') {
            const patch = route.request().postDataJSON();
            patches.push(patch);
            Object.assign(task, patch, { revision: task.revision + 1 });
            await route.fulfill({ json: task });
        } else if (path === '/boards/task-editing') {
            await route.fulfill({ json: board });
        } else if (path === '/boards') {
            await route.fulfill({ json: { boards: [board.board] } });
        } else if (path === '/agents') {
            await route.fulfill({ json: { agents: [agent] } });
        } else if (path === '/changes') {
            await route.abort();
        } else {
            await route.fulfill({ json: { runners: [], schemaValues: [], flowNodeClasses: [], workflowClasses: [] } });
        }
    });

    const expectLocked = async (face: Locator) => {
        await expect(face.getByLabel('Working directory')).toHaveAttribute('readonly', '');
        const criterion = face.getByLabel('Success criterion', { exact: true });
        await expect(criterion).toHaveValue('All changes are reviewed.');
        await expect(criterion).toHaveAttribute('readonly', '');
        await criterion.press('Enter');
        await criterion.press('Control+Enter');
        await expect(face.getByLabel('Success criterion', { exact: true })).toHaveCount(1);
        await expect(face.getByRole('heading', { name: 'Review instructions' })).toBeVisible();
        await expect(face.locator('[contenteditable="true"]')).toHaveCount(0);
        await expect(face.getByRole('button', { name: 'Add success criterion' })).toHaveCount(0);
        await expect(face.getByRole('button', { name: 'Remove success criterion' })).toHaveCount(0);
        await expect(face.getByRole('combobox', { name: 'Output type', exact: true })).toBeDisabled();
        await face.getByRole('tab', { name: 'Options', exact: true }).click();
        for (const name of ['Agent', 'Effort', 'Permission mode', 'Transition mode', 'On success']) {
            await expect(face.getByRole('combobox', { name, exact: true })).toBeDisabled();
        }
        await expect(face.getByRole('checkbox', { name: 'Compact' })).toBeDisabled();
        await expect(face.getByRole('button', { name: 'Instantiate template' })).toHaveCount(0);
    };

    await page.goto('boards/task-editing');
    await expect(page.getByTestId('flow-node-card')).toBeVisible();
    await expect(page.getByTestId('flow-node-card-chain')).toBeVisible();
    await page.getByTestId('flow-node-card').click();
    const panel = page.getByTestId('flow-node-panel');
    await expectLocked(panel);
    expect(patches).toEqual([]);

    for (const status of ['Draft', 'Ready']) {
        await panel.getByRole('tab', { name: 'Spec', exact: true }).click();
        const statusButton = panel.getByRole('button', { name: 'Status', exact: true });
        await expect(panel.locator('.ant-tabs-nav').getByRole('button', { name: 'Status', exact: true }))
            .toBeVisible();
        await statusButton.click();
        await page.getByRole('menuitem', { name: status, exact: true }).click();
        await expect(statusButton).toHaveAttribute('data-status', status.toLowerCase());
        await expect.poll(() => task.status).toBe(status.toLowerCase());
        await panel.getByRole('tab', { name: 'Options', exact: true }).click();
        for (const name of ['Agent', 'Effort', 'Permission mode', 'Transition mode', 'On success']) {
            await expect(panel.getByRole('combobox', { name, exact: true })).toBeEnabled();
        }
        await expect(panel.getByRole('checkbox', { name: 'Compact' })).toBeEnabled();
        await expect(panel.getByRole('button', { name: 'Instantiate template' })).toBeVisible();
        await panel.getByRole('tab', { name: 'Spec', exact: true }).click();
        await expect(panel.getByRole('combobox', { name: 'Output type', exact: true })).toBeEnabled();
        await expect(panel.getByLabel('Working directory')).toBeEditable();
        await expect(panel.getByLabel('Success criterion', { exact: true })).toBeEditable();
        await expect(panel.locator('.cm-content[contenteditable="true"]')).toBeVisible();
        await expect(panel.getByRole('button', { name: 'Add success criterion' })).toBeVisible();
    }
    const state = page.getByTestId('flow-node-card-state');
    await expect(state.getByRole('img', { name: 'play-circle' })).toBeVisible();
    const statusBox = (await panel.getByRole('button', { name: 'Status', exact: true }).boundingBox())!;
    const templateBox = (await panel.getByRole('button', { name: 'Instantiate template' }).boundingBox())!;
    expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(templateBox.x);
    expect(Math.abs(statusBox.y - templateBox.y)).toBeLessThan(1);
    await expect(page.getByTestId('flow-node-card-chain')).toHaveCount(1);
    await panel.getByLabel('Success criterion', { exact: true }).fill('The revised criterion.');
    await panel.getByRole('button', { name: 'Add success criterion' }).click();
    await expect(panel.getByLabel('Success criterion', { exact: true })).toHaveCount(2);
    await expect.poll(() => patches.some(patch => Array.isArray(patch.criteria) && patch.criteria.length === 2)).toBe(true);
});
