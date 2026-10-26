import { test, expect, resetViewState } from '../harness';

test.afterEach(resetViewState);

test('refreshes the instantiate menu after editing a node class without reloading', async ({ page }) => {
    const stamp = { createdAt: '2026-10-19T08:00:00Z', updatedAt: '2026-10-19T08:00:00Z', revision: 1 };
    const nodeClass = {
        id: 'review', title: 'Review', type: 'human', instantiable: false,
        spot: { x: 100, y: 100 }, tags: [],
        versions: [{
            id: 'review-v1', number: 1, body: 'Review the change.', criteria: [],
            status: 'published', template: false, ...stamp,
        }],
        ...stamp,
    };
    const board = {
        board: { id: 'library', slug: 'library', name: 'Library', archived: false, ...stamp },
        flowNodes: [], flowNodeClasses: [nodeClass], workflows: [], workflowClasses: [], cursor: 0,
    };
    let catalogueReads = 0;
    // The harness supplies Dashboard and worker; this catalogue stands in for hybridflow-store.
    await page.route('**/api/hybridflow/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/api/hybridflow', '');
        if (path === '/boards/library/flow-node-classes/review' && route.request().method() === 'PATCH') {
            Object.assign(nodeClass, route.request().postDataJSON(), { revision: nodeClass.revision + 1 });
            await route.fulfill({ json: nodeClass });
        } else if (path === '/flow-node-classes') {
            catalogueReads++;
            await route.fulfill({ json: {
                flowNodeClasses: [{ ...nodeClass, boardSlug: 'library', boardName: 'Library' }],
            } });
        } else if (path === '/workflow-classes') {
            await route.fulfill({ json: { workflowClasses: [] } });
        } else if (path === '/boards/library') {
            await route.fulfill({ json: board });
        } else if (path === '/boards') {
            await route.fulfill({ json: { boards: [board.board] } });
        } else if (path === '/agents' || path === '/runners') {
            await route.fulfill({ json: { agents: [], runners: [] } });
        } else if (path === '/changes') {
            await route.fulfill({ status: 204 });
        } else {
            await route.fulfill({ status: 404 });
        }
    });

    await page.goto('boards/library');
    await expect(page.getByTestId('flow-node-class-card')).toBeVisible();
    await expect.poll(() => catalogueReads).toBeGreaterThan(0);
    await page.getByTestId('flow-node-class-card').click();
    const instantiable = page.getByRole('checkbox', { name: 'Instantiable', exact: true });
    await instantiable.check();
    await expect.poll(() => nodeClass.instantiable).toBe(true);
    await page.getByTestId('flow-node-class-title').fill('Updated review');
    await expect.poll(() => nodeClass.title).toBe('Updated review');

    const canvas = page.getByTestId('content-canvas');
    await canvas.click({ button: 'right', position: { x: 20, y: 20 } });
    await expect.poll(() => catalogueReads).toBeGreaterThan(1);
    await page.getByRole('menuitem', { name: 'Instantiate class...' }).hover();
    await expect(page.getByTestId('instantiate-review')).toHaveText('Updated review (Library)');

    await page.keyboard.press('Escape');
    await instantiable.uncheck();
    await expect.poll(() => nodeClass.instantiable).toBe(false);
    await canvas.click({ button: 'right', position: { x: 20, y: 20 } });
    await expect.poll(() => catalogueReads).toBeGreaterThan(2);
    await page.getByRole('menuitem', { name: 'Instantiate class...' }).hover();
    await expect(page.getByText('Nothing instantiable anywhere yet', { exact: true })).toBeVisible();
    await expect(page.getByTestId('instantiate-review')).toBeHidden();
});
