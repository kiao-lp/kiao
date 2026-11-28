import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, workerApi } from '../harness';

test.use({ serviceWorkers: 'block' });

const git = (folder: string, ...args: string[]) =>
    execFileSync('git', ['-C', folder, ...args], { encoding: 'utf8' }).trim();

test('saves the Git identity from the focused tab and applies it to KIAO commits', async ({ page, request }) => {
    const api = workerApi();
    const { rootPath: dcmsRoot } = await (await request.get(`${api}/storeInfo`)).json();
    expect(dcmsRoot).toMatch(/\/kiao-e2e-/);
    const repository = mkdtempSync(join(dcmsRoot, 'git-identity-'));
    const folder = repository.slice(dcmsRoot.length + 1);
    const stateFile = join(dcmsRoot, '.kiao-config', 'git.conf');
    const original = existsSync(stateFile) ? readFileSync(stateFile) : null;
    const author = { name: 'Éléonore "Ellie" \\ Test', email: 'ellie@example.com' };
    const attribution = `${author.name}\n${author.email}\n${author.name}\n${author.email}`;

    try {
        git(repository, 'init', '-q');
        git(repository, 'config', 'user.name', 'Repository author');
        git(repository, 'config', 'user.email', 'repository@example.com');
        writeFileSync(join(repository, 'test.txt'), 'Test content');
        await page.route('**/api/files/config/dashboard-view-state.json', route => route.fulfill({ json: {
            version: 1,
            global: { toolBars: {
                off: [], width: {}, secondCentralArea: true,
                placement: { git: 'left', 'file-navigation-tree': 'right', 'secondary-document': 'center-2' },
                selected: { left: 'git', right: 'file-navigation-tree', 'center-2': 'secondary-document' },
            } },
            folders: {}, files: {},
        } }));

        await page.goto(`${folder}/test.txt`);
        const secondCenter = page.getByTestId('tool-bar-center-2');
        await secondCenter.getByText('No secondary document').click();
        const configuration = page.getByRole('button', { name: 'Git configuration', exact: true });
        await expect(page.getByRole('button', { name: 'Create new branch' })).toBeVisible();
        await configuration.click();
        const panel = secondCenter.getByRole('dialog', { name: 'Git configuration' });
        await panel.getByLabel('Author name').fill(author.name);
        await panel.getByLabel('Author email').fill(author.email);
        await panel.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(panel.getByRole('status')).toHaveText('Saved');
        expect(readFileSync(stateFile, 'utf8')).toContain(author.email);
        await panel.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(panel).toHaveCount(0);
        await configuration.click();
        await expect(panel.getByLabel('Author name')).toHaveValue(author.name);
        await expect(panel.getByLabel('Author email')).toHaveValue(author.email);
        await panel.getByRole('button', { name: 'Close', exact: true }).click();

        await page.getByRole('button', { name: 'Stage all changes' }).click();
        await page.getByPlaceholder(/Message \(commit on/).fill('Verify the configured author');
        await page.getByRole('button', { name: 'Commit', exact: true }).click();
        await expect(page.getByText('No changes', { exact: true })).toBeVisible();
        expect(git(repository, 'log', '-1', '--format=%an%n%ae%n%cn%n%ce')).toBe(attribution);

        const remote = join(repository, `agent-${crypto.randomUUID()}.git`);
        git(repository, 'init', '--bare', '-b', 'main', remote);
        const created = await request.post(`${api}/agentic-resources-api/agents`, { data: { repository: remote } });
        expect(created.status(), await created.text()).toBe(201);
        expect(git(remote, 'log', '-1', '--format=%an%n%ae%n%cn%n%ce')).toBe(attribution);
    } finally {
        if (original) writeFileSync(stateFile, original);
        else rmSync(stateFile, { force: true });
    }
});
