import { test, expect, resetViewState, flushViewState } from '../harness';

test('Claude sign-in survives tab return and an agent configuration refresh', async ({ page, context }) => {
    await resetViewState();
    let signedIn = false;
    let optionsReads = 0;
    let authReads = 0;
    let starts = 0;
    let cancels = 0;
    let submittedCode = '';
    let releaseOptions: (() => void) | undefined;
    let optionsWait: Promise<void> | undefined;
    const options = {
        models: [], efforts: [], permissionModes: [], defaultAgent: 'claude',
        agents: [{ value: 'claude', label: 'Claude',
            models: [{ value: 'haiku', label: 'Haiku' }],
            efforts: [{ value: 'low', label: 'Low' }],
            permissionModes: [{ value: 'manual', label: 'Manual' }],
        }],
    };
    // The CLI boundary is a fixture; no host credentials are read or changed.
    await page.route('**/hybridflow-runner/options', async route => {
        optionsReads++;
        await optionsWait;
        await route.fulfill({ json: options });
    });
    await page.route('**/hybridflow-runner/auth/status', route => {
        authReads++;
        return route.fulfill({ json: { loggedIn: signedIn, loginEnabled: true } });
    });
    await page.route('**/hybridflow-runner/auth/login/start', route => {
        starts++;
        return route.fulfill({ json: { ok: true, url: 'https://auth.example.com/authorize' } });
    });
    await page.route('**/hybridflow-runner/auth/login/cancel', route => {
        cancels++;
        return route.fulfill({ json: { ok: true } });
    });
    await page.route('**/hybridflow-runner/auth/login/code', route => {
        submittedCode = route.request().postDataJSON().code;
        signedIn = true;
        return route.fulfill({ json: { ok: true } });
    });
    await context.route('https://auth.example.com/authorize', route => route.fulfill({
        contentType: 'text/html', body: '<p>Approval code: code#state</p>',
    }));
    await page.route('**/hybridflow-runner/conversations', route => route.fulfill({ json: [] }));

    try {
        await page.goto('works');
        await expect(page.locator('.cms-top-banner')).toBeVisible();
        if (!await page.getByTestId('tool-bar-side-right').count()) {
            await page.getByTestId('bar-toggle-right').click();
        }
        await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
        await page.locator('.chat-login-banner').getByRole('button', { name: /Sign in/ }).click();
        const dialog = page.getByRole('dialog', { name: 'Sign in to Claude Code' });
        const input = dialog.getByPlaceholder('Paste the code here');
        await input.fill('code#state');
        const reads = { options: optionsReads, auth: authReads };

        const approvalPage = page.waitForEvent('popup');
        await dialog.getByRole('link', { name: 'Open the authorisation page' }).click();
        const approval = await approvalPage;
        await expect(approval.getByText('Approval code: code#state')).toBeVisible();
        // Headless tabs may stay visible; dispatch both browser visibility states explicitly.
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await approval.close();
        await page.bringToFront();
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('focus'));
        });
        await expect(input).toBeVisible();
        await expect(input).toHaveValue('code#state');
        expect({ options: optionsReads, auth: authReads }).toEqual(reads);

        optionsWait = new Promise(resolve => { releaseOptions = resolve; });
        const reloading = page.waitForRequest('**/hybridflow-runner/options');
        await page.evaluate(() => window.dispatchEvent(new Event('kiao:toolbox-changed')));
        await reloading;
        await expect(input).toBeVisible();
        await expect(input).toHaveValue('code#state');
        const reloaded = page.waitForResponse('**/hybridflow-runner/options');
        releaseOptions!();
        await reloaded;
        await expect(input).toHaveValue('code#state');

        await dialog.getByRole('button', { name: 'Validate' }).click();
        await expect(dialog).not.toBeVisible();
        await expect(page.locator('.chat-login-banner')).toHaveCount(0);
        expect(submittedCode).toBe('code#state');
        expect(starts).toBe(1);
        expect(cancels).toBe(0);
    } finally {
        releaseOptions?.();
        await page.keyboard.press('Escape');
        await flushViewState(page);
        await resetViewState();
    }
});
