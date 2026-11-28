import { test, expect, workerApi, resetViewState, flushViewState } from '../harness';
import type { Locator } from '@playwright/test';

test.afterEach(async ({ page }) => {
    await flushViewState(page);
    await resetViewState();
});

test('labels and validates limiter branches and resets the pass count', async ({ page, request }) => {
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
    let limiter: {
        id: string; type: string; status: string; maxPasses: number; remainingPasses: number;
        onSuccess?: { flowNodes: string[] };
    } | undefined;
    const targets = [
        { id: 'left', title: 'Publish', type: 'human', status: 'ready', spot: { x: 340, y: 60 }, ...stamp },
        { id: 'right', title: 'Review', type: 'human', status: 'ready', spot: { x: 340, y: 230 }, ...stamp },
    ];
    const board = {
        board: { id: 'limits', slug: 'limits', name: 'Limits', archived: false, ...stamp },
        workflows: [], cursor: 0,
    };
    await page.route('**/api/{hybridflow,agentic}/**', async route => {
        const path = new URL(route.request().url()).pathname.replace(/^\/api\/(?:hybridflow|agentic)/, '');
        const method = route.request().method();
        if (path === '/boards/limits/flow-nodes' && method === 'POST') {
            limiter = { ...route.request().postDataJSON().flowNodes[0], ...stamp };
            await route.fulfill({ json: { flowNodes: [limiter] } });
        } else if (limiter && path === `/boards/limits/flow-nodes/${limiter.id}` && method === 'PATCH') {
            const { resetPasses, ...patch } = route.request().postDataJSON();
            if (resetPasses || (patch.maxPasses !== undefined && limiter.maxPasses !== patch.maxPasses)) {
                patch.remainingPasses = patch.maxPasses ?? limiter.maxPasses;
            }
            Object.assign(limiter, patch);
            await route.fulfill({ json: limiter });
        } else if (path === '/boards/limits') {
            await route.fulfill({ json: { ...board, flowNodes: limiter ? [limiter, ...targets] : targets } });
        } else if (path === '/boards') {
            await route.fulfill({ json: { boards: [board.board] } });
        } else if (path === '/changes') {
            await route.abort();
        } else {
            await route.fulfill({ json: { agents: [], runners: [] } });
        }
    });

    await page.goto('boards/limits');
    await page.getByTestId('content-canvas').click({ button: 'right', position: { x: 50, y: 50 } });
    await page.getByRole('menuitem', { name: 'New Limiter' }).click();
    await expect.poll(() => limiter?.type).toBe('limiter');
    const card = page.locator(`[data-flow-node-id="${limiter!.id}"]`);
    const diamond = card.getByTestId('flow-node-card-kind');
    const incomplete = card.getByRole('img', { name: /^Incomplete/ });
    await expect(diamond).toHaveText('1');
    await expect(incomplete).toBeVisible();
    await expect(card.getByTestId('play-flow-node')).toHaveCount(0);

    const panel = page.getByTestId('flow-node-panel');
    const branchAlert = panel.getByRole('alert').filter({ hasText: 'Link a successor for each branch.' });
    const maximum = panel.getByRole('spinbutton', { name: 'Maximum passes' });
    await maximum.fill('3');
    await maximum.press('Enter');
    await expect(diamond).toHaveText('3');
    await expect.poll(() => limiter?.maxPasses).toBe(3);

    const passesLeft = panel.getByRole('combobox', { name: 'Passes left', exact: true });
    const noPassesLeft = panel.getByRole('combobox', { name: 'No passes left', exact: true });
    const choose = async (branch: Locator, name: string) => {
        await branch.click();
        const list = await branch.getAttribute('aria-controls');
        await page.getByRole('option', { name, exact: true }).and(page.locator(`[id^="${list}_"]`)).click();
    };
    await choose(passesLeft, 'Publish');
    await expect.poll(() => limiter?.onSuccess?.flowNodes).toEqual(['left']);
    await expect(incomplete).toBeVisible();
    await expect(branchAlert).toBeVisible();
    await expect(card.getByTestId('play-flow-node')).toHaveCount(0);

    await choose(noPassesLeft, 'Review');
    await expect.poll(() => limiter?.onSuccess?.flowNodes).toEqual(['left', 'right']);
    await expect(incomplete).toHaveCount(0);
    await expect(branchAlert).toHaveCount(0);
    await expect(card.getByTestId('play-flow-node')).toBeVisible();

    const links = page.getByTestId('content-links');
    const publishLink = links.locator('line[data-to="left"] title');
    const reviewLink = links.locator('line[data-to="right"] title');
    await expect(publishLink).toHaveText(/\(Passes left\)$/);
    await expect(reviewLink).toHaveText(/\(No passes left\)$/);
    await choose(passesLeft, 'Review');
    await expect.poll(() => limiter?.onSuccess?.flowNodes).toEqual(['right', 'left']);
    await expect(publishLink).toHaveText(/\(No passes left\)$/);
    await expect(reviewLink).toHaveText(/\(Passes left\)$/);

    Object.assign(limiter!, { remainingPasses: 0, status: 'done' });
    await page.reload();
    await card.click();
    await expect(diamond).toHaveText('0');
    await expect(card.getByTestId('play-flow-node')).toBeVisible();
    await expect(maximum).toHaveValue('3');
    await expect(panel.getByText('Review', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Reset counter' }).click();
    await expect.poll(() => limiter?.remainingPasses).toBe(3);
    await expect(diamond).toHaveText('3');

    Object.assign(targets[0], { archived: true });
    await page.reload();
    await card.click();
    await expect(incomplete).toBeVisible();
    await expect(branchAlert).toBeVisible();
    await expect(card.getByTestId('play-flow-node')).toHaveCount(0);
});
