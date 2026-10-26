import { test, expect, resetViewState, flushViewState } from '../harness';

// Stand in for the CLI/account boundary. This covers the real plugin, toolbar and
// HTTP client without changing the host's credentials or sending a model request.
test('Codex opens Usage before a signed-out conversation and offers device login', async ({ page }) => {
    await resetViewState();
    let signedIn = false;
    let approved = false;
    let creates = 0;
    let authReads = 0;
    const conversation = {
        id: 'conv-1800000000000-abcd', title: 'New conversation', folder: 'works', agent: 'codex',
        model: 'codex-model', effort: 'medium', permissionMode: 'bypassPermissions',
        thinking: true, running: false, pinned: false, archived: false, messageCount: 0,
        createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z',
    };
    const modes = [{ value: 'bypassPermissions', label: 'Bypass permissions' }];
    await page.route('**/hybridflow-runner/options', route => route.fulfill({ json: {
        models: [], efforts: [], permissionModes: modes, defaultAgent: 'codex',
        agents: [{
            value: 'codex', label: 'Codex',
            models: [{ value: 'codex-model', label: 'Codex model' }],
            efforts: [{ value: 'medium', label: 'Medium' }], permissionModes: modes,
            login: { methods: ['device', 'api-key'], enabled: true, hostCommand: 'codex login --device-auth' },
        }],
    } }));
    await page.route('**/hybridflow-runner/auth/status?agent=codex', route => {
        authReads++;
        return route.fulfill({ json: { loggedIn: signedIn, loginEnabled: true } });
    });
    await page.route('**/hybridflow-runner/auth/codex/login/start', route => route.fulfill({ json: {
        ok: true, url: 'https://auth.openai.com/codex/device', userCode: 'ABCD-EFGHI',
    } }));
    await page.route('**/hybridflow-runner/auth/codex/login/status', route => {
        if (approved) signedIn = true;
        return route.fulfill({ json: { pending: !approved, ok: approved } });
    });
    await page.route('**/hybridflow-runner/conversations', route => {
        if (route.request().method() === 'POST') {
            creates++;
            return route.fulfill({ status: 201, json: conversation });
        }
        return route.fulfill({ json: [] });
    });
    await page.route(`**/hybridflow-runner/conversations/${conversation.id}`, route => route.fulfill({
        json: { ...conversation, messages: [] },
    }));

    try {
        await page.goto('works');
        await expect(page.locator('.cms-top-banner')).toBeVisible();
        if (!await page.getByTestId('tool-bar-side-right').count()) {
            await page.getByTestId('bar-toggle-right').click();
        }
        await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
        await page.mouse.move(0, 0);
        await page.getByRole('button', { name: 'New Codex conversation' }).click();
        const usage = page.getByRole('region', { name: 'Codex', exact: true });
        await expect(usage).toBeVisible();
        expect(creates).toBe(0);
        expect(authReads).toBe(1);

        await usage.getByRole('button', { name: 'Log in to Codex' }).click();
        const dialog = page.getByRole('dialog', { name: 'Log in to Codex' });
        await expect(dialog.getByText('ABCD-EFGHI')).toBeVisible();
        await expect(dialog.getByRole('link', { name: 'Open the sign-in page' })).toHaveAttribute('href', 'https://auth.openai.com/codex/device');
        approved = true;
        await expect(dialog).not.toBeVisible();

        await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
        await page.mouse.move(0, 0);
        await page.getByRole('button', { name: 'New Codex conversation' }).click();
        await expect.poll(() => creates).toBe(1);
        await expect(page.locator('.chat-conversation-select')).toContainText('New conversation');

        // An existing conversation is checked again; a missing login must not send its prompt.
        signedIn = false;
        const prompt = page.getByRole('textbox', { name: 'Message for the agent' });
        await prompt.fill('Review this folder');
        await page.getByRole('button', { name: /Send$/ }).click();
        await expect(usage).toBeVisible();
        expect(creates).toBe(1);
        expect(authReads).toBe(3);
        await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
        await expect(prompt).toHaveValue('Review this folder');
    } finally {
        await page.keyboard.press('Escape');
        await flushViewState(page);
        await resetViewState();
    }
});
