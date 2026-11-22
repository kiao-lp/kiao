import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, resetViewState, workerApi } from '../harness';

test.afterEach(resetViewState);

const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

for (const populated of [false, true]) {
    test(`initializes ${populated ? 'a populated' : 'an empty'} Git repository from Agents`, async ({ page, request }) => {
        const scratch = mkdtempSync(join(tmpdir(), 'kiao-agent-init-'));
        const project = `agent-${crypto.randomUUID()}`;
        const repository = join(scratch, `${project}.git`);
        const protectedFiles = {
            'README.md': '# Existing project\n',
            '.gitignore': '/.apm/\n/apm.yml\n/agent.json\n',
        };
        const base = `${workerApi()}/agentic-resources-api`;
        let id: string | undefined;
        try {
            git(scratch, 'init', '--bare', '-b', 'trunk', repository);
            if (populated) {
                const source = join(scratch, 'source');
                mkdirSync(source);
                git(source, 'init', '-b', 'trunk');
                for (const [path, content] of Object.entries(protectedFiles)) writeFileSync(join(source, path), content);
                git(source, 'add', '--all');
                git(source, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'initial project');
                git(source, 'tag', 'v1.0.0');
                git(source, 'push', repository, 'HEAD', '--tags');
            }

            await page.goto('works');
            await page.locator('.cms-top-banner .anticon-more').click();
            await page.getByRole('menuitem', { name: /Agents…$/ }).click();
            await page.getByTestId('new-agent').click();
            const modal = page.getByRole('dialog', { name: 'New agent' });
            await modal.getByRole('textbox', { name: 'Git repository URL or path' }).fill(repository);
            if (populated) {
                await modal.getByTestId('new-agent-name').fill(`Reviewer ${project}`);
                await modal.getByRole('combobox', { name: 'New agent model' }).fill('test-model');
                await modal.getByRole('textbox', { name: 'New agent effort' }).fill('high');
                await modal.getByTestId('new-agent-instructions').fill('Review the changes.');
            }
            const [created] = await Promise.all([
                page.waitForResponse(response => response.request().method() === 'POST'
                    && new URL(response.url()).pathname === '/api/agentic/agents'),
                modal.getByTestId('create-agent').click(),
            ]);
            expect(created.status(), await created.text()).toBe(201);
            const agent = await created.json();
            id = agent.id;
            expect(agent).toMatchObject({ name: populated ? `Reviewer ${project}` : project, repository, project });
            expect(agent.published).toBeUndefined();
            await expect(modal).toBeHidden();

            const response = await request.get(`${base}/agentic-resources`);
            expect(response.ok(), await response.text()).toBeTruthy();
            const resources = await response.json();
            expect(resources).toContainEqual(expect.objectContaining({
                name: project, dirty: false, commit: git(repository, 'rev-parse', 'refs/heads/trunk').trim(),
            }));
            expect(JSON.parse(git(repository, 'show', 'HEAD:agent.json'))).toMatchObject({ id, name: agent.name, harness: agent.harness });
            expect(JSON.parse(git(repository, 'show', 'HEAD:apm.yml'))).toMatchObject({ name: project, version: '0.0.0' });
            const definition = git(repository, 'show', `HEAD:.apm/agents/${project}.agent.md`);

            if (populated) {
                expect(definition).toContain('Review the changes.');
                for (const [path, content] of Object.entries(protectedFiles)) expect(git(repository, 'show', `HEAD:${path}`)).toBe(content);
                expect(git(repository, 'rev-parse', 'HEAD^')).toBe(git(repository, 'rev-parse', 'v1.0.0'));
                const released = await request.post(`${base}/agents/${id}/publish`, { timeout: 60000 });
                expect(released.status(), await released.text()).toBe(201);
                expect((await released.json()).published).toMatchObject({
                    version: '1.0.1', tag: 'v1.0.1', commit: git(repository, 'rev-parse', 'v1.0.1^{commit}').trim(),
                });
            } else {
                expect(git(repository, 'tag', '--list')).toBe('');
                expect(git(repository, 'show', 'HEAD:.gitignore')).toContain('apm_modules/');
            }
        } finally {
            if (id) {
                const deletion = await request.get(`${base}/agents/${id}/deletion`);
                if (deletion.ok()) await request.delete(`${base}/agents/${id}?confirmation=${(await deletion.json()).confirmation}`);
            }
            rmSync(scratch, { recursive: true, force: true });
        }
    });
}
