import { test, expect, resetViewState } from '../harness';

// The harness has no boards backend. Keep a small catalogue at the HTTP boundary;
// PostgreSQL persistence and prompt isolation are covered by their Go tests.
test.afterEach(resetViewState);

test('edits agent selection guidance separately and keeps it out of the task agent picker', async ({ page }) => {
    const stamp = { createdAt: '2026-10-16T12:00:00Z', updatedAt: '2026-10-16T12:00:00Z', revision: 1 };
    const agent = {
        id: 'reviewer', name: 'Reviewer', platform: 'claude', model: 'opus',
        description: 'Review code for correctness.', instructions: 'Be concise.', ...stamp,
    };
    const board = {
        board: { id: 'selection', slug: 'selection', name: 'Selection', archived: false, ...stamp },
        flowNodes: [{ id: 'review', title: 'Review the change', type: 'ai', status: 'ready',
            body: 'Review the diff.', settings: { agent: 'reviewer', effort: 'high', permission: 'manual', folder: '/' },
            spot: { x: 100, y: 100 }, ...stamp }],
        flowNodeClasses: [], workflows: [], workflowClasses: [], cursor: 0,
    };
    const patches: unknown[] = [];
    await page.route('**/api/hybridflow/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/api/hybridflow', '');
        if (path === '/agents/reviewer' && route.request().method() === 'PATCH') {
            const patch = route.request().postDataJSON();
            patches.push(patch);
            Object.assign(agent, patch, { revision: agent.revision + 1 });
            await route.fulfill({ json: agent });
        } else if (path === '/agents') {
            await route.fulfill({ json: { agents: [agent] } });
        } else if (path === '/boards/selection') {
            await route.fulfill({ json: board });
        } else if (path === '/boards') {
            await route.fulfill({ json: { boards: [board.board] } });
        } else if (path === '/runners') {
            await route.fulfill({ json: { runners: [] } });
        } else if (path === '/changes') {
            await route.fulfill({ status: 204 });
        } else {
            await route.fulfill({ status: 404 });
        }
    });

    await page.goto('boards/selection');
    await expect(page.getByTestId('flow-node-card')).toBeVisible();
    if (await page.getByTestId('tool-bar-side-right').count() === 0) {
        await page.getByTestId('bar-toggle-right').click();
    }
    await page.getByRole('tab', { name: 'Node agents', exact: true }).click();
    await page.mouse.move(0, 0);
    // The list keeps the guidance folded until asked, and never shows the instructions.
    await expect(page.getByTestId('agent-card')).toBeVisible();
    await expect(page.getByTestId('agent-description-text')).toHaveCount(0);
    await page.getByTestId('agent-description-toggle').click();
    await expect(page.getByTestId('agent-description-text')).toHaveText(agent.description);
    await expect(page.getByTestId('agent-card')).not.toContainText('Be concise.');

    // Editing happens in the central area, where there is room for every field.
    await page.getByTestId('edit-agent').click();
    const editor = page.getByTestId('agent-editor');
    await expect(editor).toBeVisible();
    const description = editor.getByTestId('agent-description');
    await expect(description).toHaveValue(agent.description);
    await description.fill('Review Go code for correctness.');
    await description.press('Tab');
    await expect.poll(() => patches).toEqual([{ description: 'Review Go code for correctness.' }]);
    await expect(editor.getByTestId('agent-instructions')).toHaveValue('Be concise.');
    await page.getByTestId('central-panel-agent-editor-close').click();

    await page.getByTestId('flow-node-card').dblclick();
    const picker = page.getByTestId('flow-node-agent').locator('input');
    await picker.click();
    const popup = page.locator('.ant-select-dropdown:visible');
    await expect(popup.getByText('Reviewer', { exact: true })).toBeVisible();
    await expect(popup.getByText('Review Go code for correctness.', { exact: true })).toHaveCount(0);
    await expect(popup.getByText('Be concise.', { exact: true })).toHaveCount(0);
});
