import { test, expect, resetViewState, workerApi } from '../harness';

test.afterEach(resetViewState);

test('keeps role edits through live refresh and reload and resolves role references', async ({ page, request }) => {
    test.skip(!process.env.E2E_HYBRIDFLOW_URL, 'requires the throwaway boards backend');

    const boards = `${workerApi()}/hybridflow-runner/boards`;
    const created = await request.post(boards, {
        data: { name: `Roles ${crypto.randomUUID().slice(0, 8)}` },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { board } = await created.json();
    const path = `${boards}/${board.slug}`;
    try {
        const seeded = await request.post(`${path}/flow-nodes`, {
            data: { flowNodes: [
                { type: 'note', note: 'Review team: {{role.reviewers}}', spot: { x: 250, y: 40 } },
                { type: 'human', title: 'Review', status: 'todo', spot: { x: 250, y: 180 },
                    criteria: [{ text: 'Checked with {{role.reviewers}}.' }] },
            ] },
        });
        expect(seeded.ok(), await seeded.text()).toBe(true);
        const { flowNodes: [note] } = await seeded.json();

        await page.goto(`boards/${board.slug}`);
        await page.getByTestId('content-canvas').click({ button: 'right', position: { x: 50, y: 50 } });
        await page.getByRole('menuitem', { name: 'New Role' }).click();
        const node = page.getByTestId('flow-node-card').and(page.locator('[data-shape="actor"]'));
        const symbol = node.getByRole('img', { name: 'Role', exact: true });
        const robot = node.getByRole('img', { name: 'Agent role', exact: true }).locator('.anticon-robot');
        const panel = page.getByTestId('flow-node-panel');
        const human = panel.getByRole('radio', { name: 'Human', exact: true });
        const agent = panel.getByRole('radio', { name: 'Agent', exact: true });
        const name = panel.getByRole('textbox', { name: 'Role name' });
        const id = panel.getByRole('textbox', { name: 'Role ID' });
        const description = panel.getByRole('textbox', { name: 'Description' });
        const people = panel.getByRole('textbox', { name: 'People' });
        const noteBody = page.getByTestId('flow-node-note-body');
        await expect(human).toBeChecked();
        await name.fill('Review team');
        await id.fill('reviewers');
        await id.press('Enter');
        const summary = 'Review changes before release.';
        await description.fill(`  ${summary}  `);
        await description.press('Tab');
        const first = '"Alex Rivera" <alex@example.com>';
        const second = 'Sam Lee';
        await people.fill(`${first}\n${second}`);
        await people.press('Tab');

        const title = node.getByText('Review team', { exact: true });
        await expect(title).toBeVisible();
        await expect(symbol.locator('svg')).toBeVisible();
        const glyphBox = (await symbol.boundingBox())!;
        expect((await title.boundingBox())!.y).toBeGreaterThanOrEqual(glyphBox.y + glyphBox.height);
        await expect(node.getByTestId('flow-node-card-chain')).toHaveCount(0);
        await expect(node.getByTestId('play-flow-node')).toHaveCount(0);

        const savedRole = async () => {
            const snapshot = await (await request.get(path)).json();
            return snapshot.flowNodes.find((flowNode: { type: string }) => flowNode.type === 'role');
        };
        await agent.check();
        await expect(robot).toBeVisible();
        await expect.poll(savedRole).toMatchObject({
            title: 'Review team', roleId: 'reviewers', roleKind: 'agent', description: summary, people: [first, second],
        });
        await page.reload();
        await expect(robot).toBeVisible();
        await node.click();
        await expect(agent).toBeChecked();
        await expect(id).toHaveValue('reviewers');
        await expect(description).toHaveValue(summary);
        await expect(people).toHaveValue(`${first}\n${second}`);
        await expect(noteBody).toContainText('alex@example.com, Sam Lee');
        await page.getByRole('button', { name: 'Work on this task', exact: true }).click();
        await expect(page.getByTestId('work-on-task-criteria')).toHaveText(`Checked with ${first}, ${second}.`);

        await page.goto(`boards/${board.slug}`);
        await node.click();
        const revised = '"Alex Kim" <alex@example.com>';
        await people.fill(revised);
        const role = await savedRole();
        const otherEdit = await request.patch(`${path}/flow-nodes/${role.id}`, { data: { people: ['Jo Cook'] } });
        expect(otherEdit.ok(), await otherEdit.text()).toBe(true);
        await expect(noteBody).toContainText('Jo Cook');
        await expect(people).toHaveValue(revised);
        await people.press('Tab');
        await id.fill('release-reviewers');
        await id.press('Tab');
        await expect.poll(savedRole).toMatchObject({ roleId: 'release-reviewers', people: [revised], description: summary });

        const refreshed = await request.patch(`${path}/flow-nodes/${note.id}`, {
            data: { note: 'Release team: {{role.release-reviewers}}' },
        });
        expect(refreshed.ok(), await refreshed.text()).toBe(true);
        await expect(noteBody).toContainText('Release team:');
        await expect(noteBody).toContainText('Alex Kim');
        await expect(id).toHaveValue('release-reviewers');
        await expect(people).toHaveValue(revised);
        await expect(description).toHaveValue(summary);

        await description.fill('');
        await description.press('Tab');
        await human.check();
        await expect.poll(async () => {
            const role = await savedRole();
            return { roleKind: role.roleKind, description: role.description ?? '' };
        }).toEqual({ roleKind: 'human', description: '' });
        await page.reload();
        await expect(symbol).toBeVisible();
        await node.click();
        await expect(human).toBeChecked();
        await expect(description).toHaveValue('');
    } finally {
        await request.delete(path);
    }
});
