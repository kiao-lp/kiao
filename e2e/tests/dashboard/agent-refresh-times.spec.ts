import { test, expect, resetViewState, flushViewState } from '../harness';

test.use({ locale: 'fr-FR', timezoneId: 'Europe/Paris' });

test('quota gauges mark current time and refresh datetimes stay local across surfaces', async ({ page }, testInfo) => {
    await resetViewState();
    const reset = '2026-10-23T09:59:32Z';
    await page.clock.setFixedTime(Date.parse(reset) - 150 * 60_000);
    const retry = Date.parse(reset) + 60_000;
    const platforms = [['claude', 'Claude'], ['codex', 'Codex'], ['muse', 'Muse'], ['opencode', 'OpenCode'], ['pi', 'Pi (Agent)']];
    const modes = [{ value: 'bypassPermissions', label: 'Bypass permissions' }];
    const conversation = {
        id: 'conv-refresh-times', title: 'Muse quota', folder: 'works', agent: 'muse',
        model: 'fixture-model', effort: 'medium', permissionMode: 'bypassPermissions',
        thinking: true, running: false, pinned: false, archived: false, messageCount: 1,
        createdAt: reset, updatedAt: reset,
    };
    const run = {
        id: 'run-refresh-times', name: 'Refresh check', path: 'refresh-times',
        rootFlowNodeId: 'node-refresh-times', flowNodeId: 'node-refresh-times',
        state: 'refreshing', retryAt: retry, startedAt: Date.parse(reset), chat: conversation.id,
    };
    await page.route('**/hybridflow-runner/options', route => route.fulfill({ json: {
        models: [], efforts: [], permissionModes: modes, defaultAgent: 'muse',
        agents: platforms.map(([value, label]) => ({ value, label,
            models: [{ value: 'fixture-model', label: 'Fixture' }],
            efforts: [{ value: 'medium', label: 'Medium' }], permissionModes: modes,
        })),
    } }));
    await page.route('**/hybridflow-runner/usage?agent=*', route => route.fulfill({ json: {
        windows: [{ windowMinutes: 300, percentUsed: 42, resetAtEpochSeconds: Date.parse(reset) / 1000 }],
    } }));
    await page.route('**/hybridflow-runner/auth/status?agent=*', route => route.fulfill({ json: { loggedIn: true } }));
    await page.route('**/hybridflow-runner/chain-runs', route => route.fulfill({ json: { runs: [run] } }));
    await page.route('**/hybridflow-runner/conversations', route => route.fulfill({ json: [conversation] }));
    await page.route(`**/hybridflow-runner/conversations/${conversation.id}`, route => route.fulfill({ json: {
        ...conversation, messages: [{ id: 'quota-notice', role: 'assistant', at: reset,
            text: `Your usage window resets at ${reset}` }],
    } }));
    await page.routeWebSocket('**/api/ws/hybridflow-runner', socket => {
        socket.send(JSON.stringify({
            type: 'hello', protocolVersion: 20, serviceInstanceId: 'refresh-times',
            agents: platforms.map(([value]) => value), runningConversations: [], maxConcurrentTurns: 4, chainRuns: [run],
        }));
        socket.onMessage(raw => {
            const message = JSON.parse(String(raw));
            if (message.type === 'subscribe') {
                socket.send(JSON.stringify({ type: 'error', conversationId: conversation.id,
                    code: 'cli_error', message: `Your usage window resets at ${reset}` }));
            }
        });
    });
    // The board service and model accounts are fixtures; the real assembly renders every surface.
    await page.route('**/api/hybridflow/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/boards/refresh-times')) return route.fulfill({ json: {
            board: { id: 'board-refresh-times', slug: 'refresh-times', name: 'Refresh times',
                createdAt: reset, updatedAt: reset, revision: 1, archived: false },
            flowNodes: [{ id: run.flowNodeId, title: 'Waiting for Muse', type: 'ai',
                body: 'Resume the interrupted task.', settings: { agent: 'muse' },
                spot: { x: 40, y: 40 }, status: 'waiting-refresh', run: run.id,
                createdAt: reset, updatedAt: reset, revision: 1 }],
            flowNodeClasses: [], workflows: [], workflowClasses: [], cursor: 0,
        } });
        if (path.endsWith('/changes')) return route.fulfill({ status: 503 });
        return route.fulfill({ json: { boards: [], agents: [], runners: [] } });
    });

    try {
        await page.goto('boards/refresh-times');
        await expect(page.getByTestId('flow-node-card-state')).toHaveText(/back at ven\. 23 oct\., 12:00/);
        if (!await page.getByTestId('tool-bar-side-right').count()) await page.getByTestId('bar-toggle-right').click();
        await page.getByRole('tab', { name: 'Usage', exact: true }).click();
        for (const [, label] of platforms.slice(0, 3)) {
            const section = page.getByRole('region', { name: label, exact: true });
            await section.getByRole('button', { name: `Actualiser l'usage ${label}` }).click();
            await expect(section.locator('.chat-usage-reset')).toHaveText('reset ven. 23 oct., 11:59');
            const marker = await section.locator('.chat-usage-time-rail').evaluate(rail => {
                const style = getComputedStyle(rail, '::after');
                const bounds = rail.getBoundingClientRect();
                return {
                    position: style.position, width: parseFloat(style.width), height: parseFloat(style.height),
                    left: parseFloat(style.left) / bounds.width, top: parseFloat(style.top) / bounds.height,
                    barHeight: bounds.height,
                };
            });
            expect(marker.position).toBe('absolute');
            expect(marker.width).toBe(2);
            expect(marker.height).toBeGreaterThan(marker.barHeight);
            expect(marker.left).toBeCloseTo(0.5, 3);
            expect(marker.top).toBeCloseTo(0.5, 3);
        }
        await page.screenshot({ path: testInfo.outputPath('usage-time-markers.png') });
        await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
        await page.locator('.chat-conversation-select').click();
        await page.locator('.chat-conversation-popup').getByText('Muse quota', { exact: true }).click();
        await expect(page.locator('.chat-message-markdown')).toHaveText('Your usage window resets at ven. 23 oct., 11:59');
        await expect(page.getByRole('alert')).toContainText('Your usage window resets at ven. 23 oct., 11:59');
        await page.screenshot({ path: testInfo.outputPath('refresh-times.png') });
    } finally {
        await flushViewState(page);
        await resetViewState();
    }
});
