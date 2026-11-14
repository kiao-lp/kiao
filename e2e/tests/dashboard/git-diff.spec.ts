import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, workerApi, type Page } from '../harness';

test.use({ serviceWorkers: 'block' });

const original = 'hello world\nshared one\nshared two\nshared three\nshared four\nlast original\n';
const working = original.replace('world', 'earth').replace('last original', 'last changed');
const longOriginal = Array.from({ length: 200 }, (_, i) => i === 40
    ? `wrapped line ${'long text '.repeat(50)}`
    : `shared line ${String(i).padStart(3, '0')}`).join('\n');
const longWorking = longOriginal.replace('shared line 010',
    `${Array.from({ length: 20 }, (_, i) => `inserted line ${i}`).join('\n')}\nshared line 010`)
    .replace('shared line 120', 'edited line 120');

let folder: string;

test.beforeEach(async ({ page, request }) => {
    const response = await request.get(`${workerApi()}/storeInfo`);
    expect(response.ok()).toBeTruthy();
    const { rootPath } = await response.json();
    expect(rootPath).toMatch(/\/kiao-e2e-/);
    const repo = mkdtempSync(join(rootPath, 'git-diff-'));
    folder = repo.slice(rootPath.length + 1);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
    git('init', '--quiet');
    writeFileSync(join(repo, 'compare.txt'), original);
    writeFileSync(join(repo, 'long.txt'), longOriginal);
    writeFileSync(join(repo, 'deleted.txt'), 'removed file\n');
    writeFileSync(join(repo, 'other.md'), '# Other document\n');
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'fixture');
    writeFileSync(join(repo, 'compare.txt'), working);
    writeFileSync(join(repo, 'long.txt'), longWorking);
    writeFileSync(join(repo, 'added.txt'), 'added file\n');
    git('rm', '--quiet', 'deleted.txt');
    await page.route('**/api/files/config/dashboard-view-state.json', route => route.fulfill({ json: {
        version: 1,
        global: { toolBars: {
            off: [], width: {},
            placement: { git: 'left', 'file-navigation-tree': 'right' },
            selected: { left: 'git', right: 'file-navigation-tree' },
        } },
        folders: {}, files: {},
    } }));
});

const openDiff = async (page: Page, name = 'compare.txt') => {
    await page.goto(`${folder}/compare.txt`);
    await page.locator('.git-file-row').filter({ hasText: name }).click();
    const panel = page.getByTestId('central-panel-git-diff');
    await expect(panel.locator('.cm-mergeView')).toBeVisible();
    return panel;
};

test('highlights characters, updates the diff while typing, saves and opens the file', async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const panel = await openDiff(page);
    const head = panel.getByRole('textbox', { name: 'Head pane' });
    const tree = panel.getByRole('textbox', { name: 'Working tree pane' });
    await expect(head).toHaveAttribute('contenteditable', 'false');
    await expect(tree).toHaveAttribute('contenteditable', 'true');
    await expect(panel.locator('.cm-merge-a .cm-changedText').first()).toHaveText('world');
    await expect(panel.locator('.cm-merge-b .cm-changedText').first()).toHaveText('earth');
    await expect(panel.locator('.git-diff-hunk-counter')).toHaveText('– / 2');
    await expect(panel.getByRole('button', { name: /save/i })).toBeDisabled();

    await tree.fill(original);
    await expect(panel.locator('.git-diff-hunk-counter')).toHaveText('no change');
    await expect(panel.getByRole('button', { name: 'Next change' })).toBeDisabled();
    await expect(panel.locator('.cm-changedText')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /save/i })).toBeEnabled();

    await page.getByTestId(`nav-item-${folder}/other.md`).click();
    await expect(page).toHaveURL(new RegExp(`/${folder}/other\\.md$`));
    await expect(panel.locator('.cm-merge-b .cm-line')).toHaveText(original.split('\n'));
    await expect(panel.getByRole('button', { name: /save/i })).toBeEnabled();
    await panel.getByRole('button', { name: /reload/i }).click();
    await expect(panel.locator('.cm-merge-b .cm-line')).toHaveText(original.split('\n'));
    await expect(panel.getByRole('button', { name: /save/i })).toBeEnabled();
    await panel.getByRole('button', { name: /save/i }).click();
    await expect(panel.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(await (await request.get(`${workerApi()}/git/working?folder=${folder}&path=compare.txt`)).text()).toBe(original);
    await expect(panel.locator('.git-diff-hunk-counter')).toHaveText('no change');

    await panel.getByRole('button', { name: 'Open file' }).click();
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/${folder}/compare\\.txt$`));
    expect(errors).toEqual([]);
});

test('navigates changes with buttons and F7, wrapping in both directions', async ({ page }) => {
    const panel = await openDiff(page);
    const counter = panel.locator('.git-diff-hunk-counter');
    await panel.getByRole('button', { name: 'Previous change' }).click();
    await expect(counter).toHaveText('2 / 2');
    await panel.getByRole('button', { name: 'Next change' }).click();
    await expect(counter).toHaveText('1 / 2');
    await panel.getByRole('textbox', { name: 'Working tree pane' }).focus();
    await page.keyboard.press('F7');
    await expect(counter).toHaveText('2 / 2');
    await page.keyboard.press('F7');
    await expect(counter).toHaveText('1 / 2');
    await page.keyboard.press('Shift+F7');
    await expect(counter).toHaveText('2 / 2');
    await page.getByTestId('central-panel-git-diff-close').click();
    await expect(panel).toHaveCount(0);
    await page.locator('.git-file-row').filter({ hasText: 'compare.txt' }).click();
    await expect(counter).toHaveText('– / 2');
});

test('keeps wrapped unchanged lines aligned while scrolling from either pane and navigating', async ({ page }) => {
    const panel = await openDiff(page, 'long.txt');
    const scroller = panel.locator('.cm-mergeView');
    await expect.poll(() => scroller.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    const assertAligned = async () => {
        await expect.poll(() => panel.evaluate(element => {
            const left = [...element.querySelectorAll('.cm-merge-a .cm-line')];
            const right = [...element.querySelectorAll('.cm-merge-b .cm-line')];
            const pairs = left.flatMap(line => {
                const match = right.find(other => other.textContent === line.textContent);
                return match ? [Math.abs(line.getBoundingClientRect().top - match.getBoundingClientRect().top)] : [];
            });
            return pairs.length > 5 && pairs.every(delta => delta < 2);
        })).toBe(true);
    };
    await panel.locator('.cm-merge-a').hover();
    await page.mouse.wheel(0, 900);
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await assertAligned();
    const before = await scroller.evaluate(element => element.scrollTop);
    await panel.locator('.cm-merge-b').hover();
    await page.mouse.wheel(0, -300);
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeLessThan(before);
    await assertAligned();
    await panel.getByRole('button', { name: 'Next change' }).click();
    await panel.getByRole('button', { name: 'Next change' }).click();
    await expect(panel.locator('.git-diff-hunk-counter')).toHaveText('2 / 2');
    await expect(panel.locator('.cm-merge-a .cm-line').filter({ hasText: 'shared line 120' })).toBeInViewport();
    await assertAligned();
});

test('compares added and deleted files with an empty pane', async ({ page }) => {
    const panel = await openDiff(page, 'added.txt');
    await expect(panel.getByRole('textbox', { name: 'Head pane' })).toHaveText('');
    await expect(panel.getByRole('textbox', { name: 'Working tree pane' })).toContainText('added file');
    await panel.getByRole('button', { name: 'Next change' }).click();
    await expect(panel.locator('.git-diff-hunk-counter')).toHaveText('1 / 1');
    await page.locator('.git-file-row').filter({ hasText: 'deleted.txt' }).click();
    await expect(panel.getByRole('textbox', { name: 'Head pane' })).toContainText('removed file');
    await expect(panel.getByRole('textbox', { name: 'Working tree pane' })).toHaveText('');
    await panel.getByRole('button', { name: 'Previous change' }).click();
    await expect(panel.locator('.git-diff-hunk-counter')).toHaveText('1 / 1');
});
