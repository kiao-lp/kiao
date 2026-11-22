import { test, expect, resetViewState } from '../harness';

test.afterEach(resetViewState);

test('keeps modals, masks and dropdowns above stack panels', async ({ page }) => {
    const agent = {
        id: 'reviewer', name: 'Reviewer', harness: 'claude', model: 'opus',
        createdAt: '', updatedAt: '', revision: 1,
    };
    await page.route('**/api/agentic/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/api/agentic', '');
        if (path === '/agents') await route.fulfill({ json: { agents: [agent] } });
        else if (path === '/agents/reviewer/deletion') await route.fulfill({ json: { confirmation: 'test' } });
        else await route.fulfill({ status: 404 });
    });

    await page.goto('works');
    await page.locator('.cms-top-banner .anticon-more').click();
    await page.getByRole('menuitem', { name: /Agents…$/ }).click();
    const panel = page.getByTestId('central-panel-hybridflow-ui-agents');
    await expect(panel.getByTestId('agent-card')).toBeVisible();
    await panel.getByTestId('new-agent').click();

    const modal = page.getByRole('dialog', { name: 'New agent' });
    const repository = modal.getByRole('textbox', { name: 'Git repository URL' });
    await repository.click({ timeout: 10000 });
    await repository.fill('https://example.com/agent.git');
    await expect(repository).toBeFocused();

    // Hit testing catches stacking failures that visibility assertions cannot detect.
    await expect.poll(() => panel.evaluate(element => {
        const box = element.getBoundingClientRect();
        return !!document.elementFromPoint(box.left + 8, box.top + 8)?.closest('.ant-modal-root');
    })).toBe(true);
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(modal).not.toBeVisible();

    await panel.getByTestId('edit-agent').click();
    const editor = page.getByTestId('central-panel-agent-editor');
    await editor.getByTestId('agent-harness').click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').first().click();
    await page.getByTestId('central-panel-agent-editor-close').click();
    await expect(panel).toBeVisible();

    await panel.getByTestId('delete-agent').click();
    const confirmation = page.getByRole('dialog', { name: 'Delete Reviewer?' });
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(panel.getByTestId('agent-card')).toBeVisible();
});
