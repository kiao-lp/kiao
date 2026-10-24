import { test, expect, resetViewState } from '../harness';

test.afterEach(resetViewState);

test('converts a task between AI and Human from its context menu and preserves its work', async ({ page }) => {
    const stamp = { createdAt: '2026-10-19T08:00:00Z', updatedAt: '2026-10-19T08:00:00Z', revision: 1 };
    const task = {
        id: 'review', title: 'Review the change', type: 'ai', status: 'done',
        body: 'Review the diff.', criteria: [{ id: 'checked', text: 'Check correctness.' }],
        complexity: 5, tags: ['review'], chat: 'review-chat', workflow: 'release',
        settings: {
            agent: 'reviewer', model: 'opus', effort: 'high', permission: 'manual',
            folder: '/docs', runner: 'local',
        },
        onSuccess: { flowNode: 'ship', mode: 'continue', compact: true },
        spot: { x: 100, y: 100 }, ...stamp,
    };
    const original = structuredClone(task);
    const board = {
        board: { id: 'conversion', slug: 'conversion', name: 'Conversion', archived: false, ...stamp },
        flowNodes: [task, {
            id: 'ship', title: 'Ship the change', type: 'human', status: 'ready',
            spot: { x: 500, y: 100 }, ...stamp,
        }, {
            id: 'pause', title: 'Pause', type: 'scheduler', duration: '15m', status: 'ready',
            spot: { x: 100, y: 400 }, ...stamp,
        }],
        flowNodeClasses: [], workflows: [{ id: 'release', name: 'Release', ...stamp }],
        workflowClasses: [], cursor: 0,
    };
    const patches: unknown[] = [];
    // The harness has no boards backend; record writes at its HTTP boundary.
    await page.route('**/api/hybridflow/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/api/hybridflow', '');
        if (path === '/boards/conversion/flow-nodes/review' && route.request().method() === 'PATCH') {
            const patch = route.request().postDataJSON();
            patches.push(patch);
            Object.assign(task, patch, { revision: task.revision + 1 });
            await route.fulfill({ json: task });
        } else if (path === '/boards/conversion') {
            await route.fulfill({ json: board });
        } else if (path === '/boards') {
            await route.fulfill({ json: { boards: [board.board] } });
        } else if (path === '/agents') {
            await route.fulfill({ json: { agents: [{
                id: 'reviewer', name: 'Reviewer', platform: 'claude', model: 'opus', ...stamp,
            }] } });
        } else if (path === '/runners') {
            await route.fulfill({ json: { runners: [{ id: 'local', name: 'Local', ...stamp }] } });
        } else if (path === '/flow-node-classes') {
            await route.fulfill({ json: { flowNodeClasses: [] } });
        } else if (path === '/workflow-classes') {
            await route.fulfill({ json: { workflowClasses: [] } });
        } else if (path === '/changes') {
            await route.fulfill({ status: 204 });
        } else {
            await route.fulfill({ status: 404 });
        }
    });

    await page.goto('boards/conversion');
    const card = page.getByTestId('flow-node-card').filter({ hasText: task.title });
    await expect(card.getByTestId('flow-node-card-chip').filter({ hasText: 'Reviewer' })).toBeVisible();
    await card.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Convert' }).hover();
    await expect(page.getByRole('menuitem', { name: 'Node class' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'AI task' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Human task' }).click();

    const humanPatch = {
        type: 'human', settings: { folder: '/docs' }, onSuccess: { flowNode: 'ship', mode: 'end' },
    };
    await expect.poll(() => patches).toEqual([humanPatch]);
    expect(task).toEqual({ ...original, ...humanPatch, revision: 2 });
    await page.reload();
    await expect(card.getByTestId('flow-node-card-kind')).toHaveAttribute('data-type', 'human');

    await card.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Convert' }).hover();
    await expect(page.getByRole('menuitem', { name: 'Human task' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'AI task' }).click();

    const aiPatch = { type: 'ai', settings: { folder: '/docs', agent: 'reviewer' } };
    await expect.poll(() => patches).toEqual([humanPatch, aiPatch]);
    expect(task).toEqual({ ...original, ...humanPatch, ...aiPatch, revision: 3 });
    await page.reload();
    await expect(card.getByTestId('flow-node-card-invalid')).toBeVisible();
    await expect(card.getByTestId('flow-node-card-kind')).toHaveCount(0);

    await page.getByTestId('flow-node-card').filter({
        has: page.locator('[data-type="scheduler"]'),
    }).click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Clone node' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Convert' })).toHaveCount(0);
});
