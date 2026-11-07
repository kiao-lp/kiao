import { test, expect, resetViewState } from '../harness';
import type { Locator } from '@playwright/test';

test.afterEach(resetViewState);

test('AI task fields are read-only outside Draft and Ready in both editors', async ({ page }) => {
    const stamp = { createdAt: '2026-10-31T08:00:00Z', updatedAt: '2026-10-31T08:00:00Z', revision: 1 };
    const agent = {
        id: 'reviewer', name: 'Reviewer', platform: 'claude', model: 'opus', ...stamp,
        published: { agentId: 'reviewer', version: 1, name: 'Reviewer', platform: 'claude', model: 'opus',
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
        for (const name of ['Agent', 'Effort', 'Permission mode', 'Transition mode', 'On success', 'Output type']) {
            await expect(face.getByRole('combobox', { name, exact: true })).toBeDisabled();
        }
        await expect(face.getByLabel('Working directory')).toHaveAttribute('readonly', '');
        await expect(face.getByRole('checkbox', { name: 'Compact' })).toBeDisabled();
        const criterion = face.getByLabel('Success criterion', { exact: true });
        await expect(criterion).toHaveValue('All changes are reviewed.');
        await expect(criterion).toHaveAttribute('readonly', '');
        await criterion.press('Enter');
        await criterion.press('Control+Enter');
        await expect(face.getByLabel('Success criterion', { exact: true })).toHaveCount(1);
        await expect(face.getByRole('heading', { name: 'Review instructions' })).toBeVisible();
        await expect(face.locator('[contenteditable="true"]')).toHaveCount(0);
        await expect(face.getByTestId('flow-node-template')).toHaveCount(0);
        await expect(face.getByRole('button', { name: 'Add success criterion' })).toHaveCount(0);
        await expect(face.getByRole('button', { name: 'Remove success criterion' })).toHaveCount(0);
    };

    await page.goto('boards/task-editing');
    await expect(page.getByTestId('flow-node-card')).toBeVisible();
    await expect(page.getByTestId('flow-node-card-chain')).toBeVisible();
    await page.getByTestId('flow-node-card').click();
    const panel = page.getByTestId('flow-node-panel');
    await expectLocked(panel);
    await panel.getByTestId('expand-flow-node').click();
    const editor = page.getByTestId('flow-node-editor');
    await expectLocked(editor);
    expect(patches).toEqual([]);

    for (const status of ['Draft', 'Ready']) {
        await editor.getByTestId('flow-node-status').click();
        await page.locator('.ant-select-dropdown:visible').getByText(status, { exact: true }).click();
        for (const face of [panel, editor]) {
            for (const name of ['Agent', 'Effort', 'Permission mode', 'Transition mode', 'On success', 'Output type']) {
                await expect(face.getByRole('combobox', { name, exact: true })).toBeEnabled();
            }
            await expect(face.getByLabel('Working directory')).toBeEditable();
            await expect(face.getByRole('checkbox', { name: 'Compact' })).toBeEnabled();
            await expect(face.getByLabel('Success criterion', { exact: true })).toBeEditable();
            await expect(face.locator('.cm-content[contenteditable="true"]')).toBeVisible();
            await expect(face.getByTestId('flow-node-template')).toBeVisible();
            await expect(face.getByRole('button', { name: 'Add success criterion' })).toBeVisible();
        }
    }
    await expect(page.getByTestId('flow-node-card-chain')).toHaveCount(1);
    await editor.getByLabel('Success criterion', { exact: true }).fill('The revised criterion.');
    await expect(panel.getByLabel('Success criterion', { exact: true })).toHaveValue('The revised criterion.');
    await editor.getByRole('button', { name: 'Add success criterion' }).click();
    await expect(editor.getByLabel('Success criterion', { exact: true })).toHaveCount(2);
    await expect.poll(() => patches.some(patch => Array.isArray(patch.criteria) && patch.criteria.length === 2)).toBe(true);
});
