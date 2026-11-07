import { test, expect, resetViewState } from '../harness';
import type { Page } from '@playwright/test';

test.afterEach(resetViewState);

const stamp = { createdAt: '2026-10-25T08:00:00Z', updatedAt: '2026-10-25T08:00:00Z', revision: 1 };
const card = (id: string, type: string, x: number, y: number, onSuccess = {}) => ({
    id, title: id, type, spot: { x, y }, status: 'ready',
    ...(type === 'scheduler' ? { duration: '1s' } : {}), onSuccess, ...stamp,
});

async function showBoard(page: Page, { invalid = false, runningTask = false } = {}) {
    const nodes = [
        {
            ...card('First', runningTask ? 'ai' : 'human', 100, 100, { flowNode: 'Shutdown', mode: 'end' }),
            ...(runningTask ? { status: 'running', chat: 'conversation-1' } : {}),
        },
        card('Second', 'scheduler', 100, 350, invalid ? { flowNode: 'Shutdown' } : {}),
        card('Shutdown', 'shutdown', 450, 100),
        card('Gateway', 'gateway', 800, 100),
        card('Left', 'scheduler', 450, 350),
        card('Right', 'scheduler', 800, 350),
    ];
    const board = {
        board: { id: 'connections', slug: 'connections', name: 'Connections', archived: false, ...stamp },
        flowNodes: nodes, flowNodeClasses: [], workflows: [], workflowClasses: [], cursor: 0,
    };
    const writes: { from: string; to: string }[] = [];
    await page.route('**/api/hybridflow/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/api/hybridflow', '');
        const chain = path.match(/^\/boards\/connections\/flow-nodes\/([^/]+)\/chain$/);
        if (chain) {
            const from = decodeURIComponent(chain[1]);
            const to = route.request().postDataJSON().flowNode;
            writes.push({ from, to });
            const node = nodes.find(node => node.id === from)!;
            node.onSuccess = node.type === 'gateway'
                ? { flowNodes: [...((node.onSuccess as { flowNodes?: string[] }).flowNodes ?? []), to] }
                : { flowNode: to, mode: 'end' };
            await route.fulfill({ json: { flowNode: node } });
        } else if (path === '/boards/connections') {
            await route.fulfill({ json: board });
        } else if (path === '/boards') {
            await route.fulfill({ json: { boards: [board.board] } });
        } else if (path === '/changes') {
            await route.abort();
        } else {
            await route.fulfill({ json: { agents: [], runners: [], flowNodeClasses: [], workflowClasses: [] } });
        }
    });
    await page.goto('boards/connections');
    await expect(page.locator('[data-flow-node-id="Second"]')).toBeVisible();
    return writes;
}

async function connect(page: Page, from: string, to: string) {
    const source = page.locator(`[data-flow-node-id="${from}"]`).getByTestId('flow-node-card-chain');
    const target = page.locator(`[data-flow-node-id="${to}"]`);
    await source.scrollIntoViewIfNeeded();
    const start = (await source.boundingBox())!;
    const end = (await target.boundingBox())!;
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
    await page.mouse.up();
}

test('limits task inputs in the editor and drag while allowing gateway joins and forks', async ({ page }) => {
    const writes = await showBoard(page);
    await page.locator('[data-flow-node-id="Second"]').click();
    await page.getByRole('combobox', { name: 'On success', exact: true }).click();
    await expect(page.locator('.ant-select-dropdown').getByText('Shutdown', { exact: true })).toHaveCount(0);
    await expect(page.locator('.ant-select-dropdown').getByText('Gateway', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await connect(page, 'Second', 'Shutdown');
    expect(writes).toEqual([]);
    await connect(page, 'Second', 'Gateway');
    await expect.poll(() => writes.length).toBe(1);
    await connect(page, 'First', 'Gateway');
    await expect.poll(() => writes.length).toBe(2);
    await connect(page, 'Gateway', 'Left');
    await expect.poll(() => writes.length).toBe(3);
    await connect(page, 'Gateway', 'Right');
    await expect.poll(() => writes.length).toBe(4);
    await expect(page.locator('[data-flow-node-id="Shutdown"]').getByTestId('flow-node-card-chain')).toHaveCount(0);
});

test('keeps the conversation and outgoing connector available while a task runs', async ({ page }) => {
    const writes = await showBoard(page, { runningTask: true });
    const task = page.locator('[data-flow-node-id="First"]');
    const chat = task.getByTestId('flow-node-card-chat');
    const connector = task.getByTestId('flow-node-card-chain');
    await expect(chat).toBeVisible();
    await expect(connector).toBeVisible();
    const chatBox = (await chat.boundingBox())!;
    const connectorBox = (await connector.boundingBox())!;
    expect(chatBox.x + chatBox.width).toBeLessThanOrEqual(connectorBox.x);

    await connect(page, 'First', 'Gateway');
    await expect.poll(() => writes).toEqual([{ from: 'First', to: 'Gateway' }]);
    await expect(chat).toBeVisible();
    await expect(task).toHaveAttribute('data-status', 'running');

    await connect(page, 'First', 'First');
    await expect.poll(() => writes).toEqual([
        { from: 'First', to: 'Gateway' },
        { from: 'First', to: '' },
    ]);
    await expect(connector).not.toHaveAttribute('data-mode');
    await expect(chat).toBeVisible();
});

test('names an invalid downstream join before a chain starts', async ({ page }) => {
    await showBoard(page, { invalid: true });
    let starts = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && request.url().endsWith('/chain-runs/play')) starts++;
    });
    await page.locator('[data-flow-node-id="Second"]').getByTestId('play-flow-node').click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByText('“Shutdown” can have only one predecessor. Use a gateway to join branches.', { exact: true })).toBeVisible();
    expect(starts).toBe(0);
});
