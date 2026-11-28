import { test, expect, resetViewState, flushViewState } from '../harness';
import type { Locator } from '../harness';
import { HARNESS_PROTOCOL_VERSION } from '../../../reference/kiao-worker/src/harness-types';

/**
 * E2E: a message put on the clipboard as the markdown it was written in.
 *
 * The transcript is a fixture, so no turn reaches a model.
 */

test('copies a prompt and a reply as the markdown they were written in', async ({ page }, testInfo) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await resetViewState();
    const at = '2026-10-23T09:00:00Z';
    const conversation = {
        id: 'conv-copy', title: 'Copy source', folder: 'works', harness: 'muse',
        model: 'fixture-model', effort: 'medium', permissionMode: 'bypassPermissions',
        thinking: true, running: false, pinned: false, archived: false, messageCount: 2,
        createdAt: at, updatedAt: at,
    };
    const mode = { value: 'bypassPermissions', label: 'Bypass permissions' };
    const prompt = 'Rewrite ## the README';
    const opening = 'Looking at `README.md`:\n\n```md\n# Old title\n```';
    const closing = 'Found it.';
    await page.route('**/hybridflow-runner/options', route => route.fulfill({ json: {
        models: [], efforts: [], permissionModes: [mode], defaultHarness: 'muse',
        harnesses: [{ value: 'muse', label: 'Muse',
            models: [{ value: 'fixture-model', label: 'Fixture' }],
            efforts: [{ value: 'medium', label: 'Medium' }], permissionModes: [mode],
        }],
    } }));
    await page.route('**/hybridflow-runner/auth/status?harness=*', route => route.fulfill({ json: { loggedIn: true } }));
    await page.route('**/hybridflow-runner/conversations?archived=true', route => route.fulfill({ json: [conversation] }));
    await page.route(`**/hybridflow-runner/conversations/${conversation.id}`, route => route.fulfill({ json: {
        ...conversation, messages: [
            { id: 'copy-prompt', role: 'user', at, text: prompt },
            { id: 'copy-reply', role: 'assistant', at, text: '', blocks: [
                { kind: 'text', text: opening },
                { kind: 'thinking', text: 'the title is stale' },
                { kind: 'tool_use', name: 'Read', input: '{"file_path": "README.md"}', detail: 'README.md' },
                { kind: 'text', text: closing },
            ] },
        ],
    } }));
    await page.routeWebSocket('**/api/ws/hybridflow-runner', socket => {
        socket.send(JSON.stringify({
            type: 'hello', protocolVersion: HARNESS_PROTOCOL_VERSION, serviceInstanceId: 'chat-copy',
            harnesses: ['muse'], runningConversations: [], maxConcurrentTurns: 4, chainRuns: [],
        }));
    });

    try {
        await page.goto('works');
        await expect(page.locator('.cms-top-banner')).toBeVisible();
        if (await page.getByTestId('tool-bar-side-right').count() === 0) await page.getByTestId('bar-toggle-right').click();
        await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
        await page.locator('.chat-conversation-select').click();
        await page.locator('.chat-conversation-popup').getByText('Copy source', { exact: true }).click();

        const copy = (message: Locator) =>
            message.getByRole('button', { name: 'Copy message as markdown' });
        const asked = page.locator('.chat-message--user');
        const answered = page.locator('.chat-message--assistant');
        await expect(answered).toContainText('Found it.');

        await asked.hover();
        await copy(asked).focus();
        await expect(page.getByRole('tooltip', { name: 'Copy message as markdown' })).toBeVisible();
        await copy(asked).click();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);

        await answered.hover();
        await copy(answered).click();
        // The prose in order, with the reasoning and the tool call between it left out.
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${opening}\n\n${closing}`);
        await page.screenshot({ path: testInfo.outputPath('chat-copy.png') });
    } finally {
        await flushViewState(page);
        await resetViewState();
    }
});
