import { test, expect, resetViewState, workerApi } from '../harness';
import { publishTestAgent, removeTestAgent } from '../conversationAgents';

test.afterEach(resetViewState);

test('renders the harness title and model names in the panel', async ({ page }) => {
    await page.route('**/hybridflow-runner/harness-models', route => route.fulfill({
        json: [{ value: 'codex', label: 'Codex' }],
    }));
    await page.route('**/hybridflow-runner/harness-models/codex', route => route.fulfill({
        json: {
            models: [{ value: 'gpt-6.2-sol', label: 'GPT-6.2 Sol' }],
            activeModels: ['gpt-6.2-sol'], defaultModel: 'gpt-6.2-sol',
        },
    }));
    await page.goto('works');
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Codex (harness)…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Codex (harness)' });
    const name = dialog.getByRole('rowheader', { name: /GPT-6\.2 Sol/ });
    await expect(name).toBeVisible();
    await expect(name).not.toHaveCSS('font-size', '0px');
    await expect(dialog.getByText('gpt-6.2-sol', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Codex (harness)', { exact: true })).toBeVisible();
});

test('saves the active models and uses the chosen column for a conversation', async ({ page, request }) => {
    test.skip(process.env.E2E_CLAUDE_PERMISSIONS !== '1', 'requires the controlled Claude CLI fixture');
    const endpoint = `${workerApi()}/hybridflow-runner/harness-models/claude`;
    const initial = await request.get(endpoint);
    expect(initial.ok()).toBe(true);
    const { activeModels, defaultModel } = await initial.json();
    const agent = await publishTestAgent(request, { name: 'Model picker reviewer', harness: 'claude', model: 'opus' });
    const conversations = `${workerApi()}/hybridflow-runner/conversations`;
    let createdId: string | undefined;
    const openModels = async () => {
        await page.getByRole('button', { name: 'Tools', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Claude Code (harness)…' }).click();
        return page.getByTestId('harness-models-panel-claude');
    };
    try {
        await page.goto('works');
        await page.getByRole('button', { name: 'Tools', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Configuration…' }).click();
        await page.getByRole('button', { name: 'Configure Claude Code (harness)', exact: true }).click();
        const panel = page.getByTestId('harness-models-panel-claude');
        await expect(panel.getByRole('radio', { name: 'Use opus by default' })).toBeChecked();
        await expect(panel.getByRole('checkbox', { name: 'Activate fable' })).not.toBeChecked();
        await panel.getByRole('checkbox', { name: 'Activate fable' }).click();
        await panel.getByRole('radio', { name: 'Use fable by default' }).click();
        await panel.getByRole('checkbox', { name: 'Activate opus' }).click();
        await expect.poll(async () => (await request.get(endpoint)).json()).toMatchObject({
            activeModels: ['sonnet', 'haiku', 'fable'], defaultModel: 'fable',
        });

        await page.reload();
        const reopened = await openModels();
        await expect(reopened.getByRole('radio', { name: 'Use fable by default' })).toBeChecked();
        await expect(reopened.getByRole('checkbox', { name: 'Activate opus' })).not.toBeChecked();
        if (!await page.getByTestId('tool-bar-side-right').count()) {
            await page.getByTestId('bar-toggle-right').click();
        }
        await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
        await page.getByRole('button', { name: 'New conversation', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'New conversation' });
        await expect(dialog.getByRole('columnheader', { name: 'Claude Code / fable' })).toBeVisible();
        await expect(dialog.getByRole('columnheader', { name: 'Claude Code / opus' })).toHaveCount(0);
        const response = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/hybridflow-runner/conversations'));
        await dialog.getByRole('button', { name: `${agent.name} · Claude Code / haiku` }).click();
        const created = await response;
        expect(created.status(), await created.text()).toBe(201);
        const conversation = await created.json();
        createdId = conversation.id;
        expect(conversation).toMatchObject({
            harness: 'claude', model: 'haiku', agentVersion: { agentId: agent.id, model: 'opus', resolvedModel: 'haiku' },
        });
    } finally {
        if (createdId) await request.delete(`${conversations}/${createdId}`);
        await removeTestAgent(request, agent.id);
        await request.put(endpoint, { data: { activeModels, defaultModel } });
    }
});

test('persists the selected model on a task and reselects its column', async ({ page, request }) => {
    test.skip(process.env.E2E_CLAUDE_PERMISSIONS !== '1', 'requires the controlled Claude CLI fixture');
    test.skip(!process.env.E2E_HYBRIDFLOW_URL, 'requires the throwaway boards backend');
    const agent = await publishTestAgent(request, { name: 'Task model reviewer', harness: 'claude', model: 'opus' });
    const boards = `${workerApi()}/hybridflow-runner/boards`;
    let boardPath: string | undefined;
    try {
        const created = await request.post(boards, { data: { name: 'Task model selection' } });
        expect(created.ok(), await created.text()).toBe(true);
        const { board } = await created.json();
        boardPath = `${boards}/${board.slug}`;
        const id = crypto.randomUUID();
        const card = await request.post(`${boardPath}/flow-nodes`, { data: { flowNodes: [{
            id, title: 'Review the result', type: 'ai', body: 'Review the proposed change.', spot: { x: 100, y: 100 },
            settings: { agent: agent.id, effort: 'low', permission: 'bypassPermissions', folder: '/' },
        }] } });
        expect(card.ok(), await card.text()).toBe(true);
        await page.goto(`boards/${board.slug}`);
        await page.getByTestId('flow-node-card').dblclick();
        await page.getByTestId('flow-node-panel').getByRole('tab', { name: 'Options', exact: true }).click();
        const picker = page.getByTestId('flow-node-agent');
        await picker.click();
        const dialog = page.getByRole('dialog', { name: 'Choose agent and harness' });
        const sonnet = dialog.getByRole('button', { name: `${agent.name} · Claude Code / sonnet` });
        await sonnet.click();
        await expect(picker).toContainText('sonnet');
        await expect.poll(async () => {
            const response = await request.get(`${boardPath}/flow-nodes/${id}`);
            return (await response.json()).settings;
        }).toMatchObject({ agent: agent.id, harness: 'claude', model: 'sonnet' });
        await picker.click();
        await expect(sonnet).toHaveAttribute('aria-pressed', 'true');
        await expect(dialog.getByRole('button', { name: `${agent.name} · Claude Code / opus` })).toHaveAttribute('aria-pressed', 'false');
    } finally {
        if (boardPath) await request.delete(boardPath);
        await removeTestAgent(request, agent.id);
    }
});
