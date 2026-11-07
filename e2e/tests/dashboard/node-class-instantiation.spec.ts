import { test, expect, resetViewState } from '../harness';

test.afterEach(resetViewState);

for (const template of [false, true]) {
    test(`instantiates a class chain from its own menu${template ? ' after filling its template' : ''}`, async ({ page }) => {
        const stamp = { createdAt: '2026-10-19T08:00:00Z', updatedAt: '2026-10-19T08:00:00Z', revision: 1 };
        const classes = [
            {
                id: 'review', title: 'Review', type: 'human', instantiable: false,
                spot: { x: 100, y: 100 }, onSuccess: { flowNode: 'approve', mode: 'end' },
                versions: [{
                    id: 'review-v1', number: 1, body: template ? 'Review ${subject:text}.' : 'Review the change.',
                    criteria: [], status: 'published', template, ...stamp,
                }],
                ...stamp,
            },
            {
                id: 'approve', title: 'Approve', type: 'human', instantiable: false,
                spot: { x: 500, y: 100 },
                versions: [{
                    id: 'approve-v1', number: 1, body: 'Approve the change.',
                    criteria: [], status: 'published', template: false, ...stamp,
                }],
                ...stamp,
            },
        ];
        const nodes: Record<string, unknown>[] = [];
        const board = {
            board: { id: 'library', slug: 'library', name: 'Library', archived: false, ...stamp },
            flowNodes: nodes, flowNodeClasses: classes, workflows: [], workflowClasses: [], cursor: 0,
        };
        const writes: unknown[] = [];
        let catalogueReads = 0;
        // The harness has no boards backend; exercise the UI and client at their HTTP boundary.
        await page.route('**/api/hybridflow/**', async route => {
            const path = new URL(route.request().url()).pathname.replace('/api/hybridflow', '');
            if (path === '/boards/library/flow-node-classes/review/instantiate' && route.request().method() === 'POST') {
                const payload = route.request().postDataJSON();
                writes.push(payload);
                nodes.push(...classes.map((one, index) => ({
                    id: `${one.id}-instance`, title: one.title, type: one.type, status: 'ready',
                    body: payload.bodies?.[one.id] ?? one.versions[0].body,
                    spot: { x: payload.spot.x + index * 293, y: payload.spot.y },
                    onSuccess: index === 0 ? { flowNode: 'approve-instance', mode: 'end' } : {},
                    classVersion: {
                        classId: one.id, classTitle: one.title,
                        versionId: one.versions[0].id, versionNumber: 1,
                    },
                    ...stamp,
                })));
                await route.fulfill({ json: { flowNodes: nodes } });
            } else if (path === '/flow-node-classes') {
                catalogueReads++;
                await route.fulfill({ json: {
                    flowNodeClasses: classes.map(one => ({ ...one, boardSlug: 'library', boardName: 'Library' })),
                } });
            } else if (path === '/boards/library') {
                await route.fulfill({ json: board });
            } else if (path === '/boards') {
                await route.fulfill({ json: { boards: [board.board] } });
            } else if (path === '/changes') {
                await route.abort();
            } else {
                await route.fulfill({ json: { agents: [], runners: [], workflowClasses: [] } });
            }
        });

        await page.goto('boards/library');
        const card = page.getByTestId('flow-node-class-card').filter({ hasText: 'Review' });
        await expect(card).toBeVisible();
        await expect.poll(() => catalogueReads).toBeGreaterThan(0);
        await card.click({ button: 'right' });
        await expect.poll(() => catalogueReads).toBeGreaterThan(1);
        await page.getByRole('menuitem', { name: /Instantiate\.\.\.$/ }).click();

        if (template) {
            const panel = page.getByTestId('central-panel-class-template-instantiation');
            await expect(panel).toBeVisible();
            expect(writes).toEqual([]);
            await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(panel).toBeHidden();
            expect(writes).toEqual([]);

            await card.click({ button: 'right' });
            await page.getByRole('menuitem', { name: /Instantiate\.\.\.$/ }).click();
            await panel.getByPlaceholder('Type something...').fill('the diff');
            await panel.getByRole('button', { name: 'Instantiate', exact: true }).click();
            await expect(panel).toBeHidden();
        }

        await expect.poll(() => writes).toEqual([{
            spot: { x: 100, y: 264 },
            ...(template ? { bodies: { review: 'Review the diff.' } } : {}),
        }]);
        await expect(page.getByTestId('flow-node-card')).toHaveCount(2);
        await expect(page.getByTestId('flow-node-class-card')).toHaveCount(2);
        await expect(page.getByTestId('flow-node-card').filter({ hasText: 'Review' })).toBeVisible();
        await expect(page.getByTestId('flow-node-card').filter({ hasText: 'Approve' })).toBeVisible();
    });
}
