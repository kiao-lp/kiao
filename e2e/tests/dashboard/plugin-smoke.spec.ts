import { test, expect, fileUrl, restoreFixture, workerApi } from '../harness';

/**
 * E2E smoke: every core plugin can open its file type.
 *
 * For each registered file type we navigate straight to a fixture file and assert
 * that the plugin's own main view mounted — a stable, plugin-specific selector, not
 * the shared CMS chrome. This guards the plugin-resolution / provider wiring that
 * later refactors (prompts 06/07) restructure: if a file type stops resolving to
 * its plugin, or a view crashes on mount, one of these cases goes red.
 *
 * One test walking the list rather than one test per type: opening a document is the whole of
 * what each case does, and a test of its own would pay for a browser context to do it in — a
 * second or so each, for twelve of them. Each type is a `test.step`, so a failure still names
 * the type it is in and the others still run.
 *
 * Fixtures live in e2e/data/files-template/ (seeded fresh per run by bin/start-env.sh).
 */

const TIMEOUT = 15000;

const BANNER = '.cms-top-banner';

type PluginCase = {
    name: string;
    /** Fixture path relative to the DCMS root and the app base URL. */
    path: string;
    /** Stable selector proving this plugin's main view rendered. */
    selector: string;
    /** Document title the plugin sets once mounted.
     *  The template plugin renders an instantiation view and titles nothing, so it has none. */
    title?: string;
    highlightedToken?: string;
};

// Types with a distinctive main-view selector. `.cm-editor` is shared by the
// CodeMirror-based editors; the navigated extension + the document title
// (which each plugin's MainView sets from the file name) disambiguates them.
const cases: PluginCase[] = [
    { name: 'markdown (.md)', path: 'welcome.md', selector: '.configured-markdown-container', title: 'welcome' },
    { name: 'text (.txt)', path: 'smoke/sample.txt', selector: '.cm-editor', title: 'sample' },
    { name: 'tabular text (.csv)', path: 'smoke/rows.csv', selector: '.cm-editor', title: 'rows' },
    { name: 'code / JSON (.json)', path: 'smoke/data.json', selector: '.cm-editor', title: 'data' },
    { name: 'PowerShell (.ps1)', path: 'smoke/hello.ps1', selector: '.code-codemirror-editor .cm-content', title: 'hello.ps1', highlightedToken: 'Write-Output' },
    { name: 'Zsh (.zsh)', path: 'smoke/hello.zsh', selector: '.code-codemirror-editor .cm-content', title: 'hello.zsh', highlightedToken: 'echo' },
    { name: 'Windows batch (.cmd)', path: 'smoke/hello.cmd', selector: '.text-codemirror-editor .cm-content', title: 'hello.cmd' },
    { name: 'JSON Schema (.schema.json)', path: 'smoke/person.schema.json', selector: '.json-schema-editor .cm-editor', title: 'person' },
    { name: 'graph (.graph.json)', path: 'smoke/example.graph.json', selector: '.graph-canvas', title: 'example' },
    { name: 'feature matrix (.fmat.json)', path: 'smoke/comparison.fmat.json', selector: '.fm-table', title: 'comparison' },
    { name: 'architecture diagram (.arch.md)', path: 'smoke/diagram.arch.md', selector: '.archdia-svg', title: 'diagram' },
    // Must beat markdown-edit to the file: `.md` would otherwise swallow `.ttst.md`, and the
    // CodeMirror editor would mount instead of the script editor asserted here.
    { name: 'TTS script (.ttst.md)', path: 'smoke/narration.FR.ttst.md', selector: '.ttst-container', title: 'narration.FR' },
    { name: 'mindmap (.mmap.json)', path: 'folder-a/Mindmap.mmap.json', selector: '.mindmap-zoom-container', title: 'Mindmap' },
    // Titled with its extension, as the image and movie viewers title theirs: `extractName`
    // keeps it, and `manual.pdf` beside `manual.md` are two documents, not one name twice.
    { name: 'PDF (.pdf)', path: 'smoke/manual.pdf', selector: '.pdf-column-scroller', title: 'manual.pdf' },
    // An instantiation view rather than an editor canvas: its title heading is what proves it
    // mounted, matching the template-copy spec's convention.
    { name: 'template (.temp.md)', path: 'templates/Prompt.temp.md', selector: 'h1:has-text("Prompt")' },
    // Titled with its extension, like the image viewer: `extractName` keeps it.
    { name: 'SVG image (.svg)', path: 'smoke/drawing.svg', selector: '.svg-canvas', title: 'drawing.svg' },
];

test('opens every core file type', async ({ page }) => {
    // Ten documents in one test: long by design, not by accident.
    test.slow();

    for (const c of cases) {
        await test.step(`opens ${c.name}`, async () => {
            await page.goto(encodeURI(c.path));
            await expect(page.locator(BANNER)).toBeVisible({ timeout: TIMEOUT });
            const view = page.locator(c.selector).first();
            await expect(view).toBeVisible({ timeout: TIMEOUT });
            if (c.title) await expect(page).toHaveTitle(c.title, { timeout: TIMEOUT });
            if (c.highlightedToken) {
                await expect(view.locator('span').filter({ hasText: c.highlightedToken })).toBeVisible({ timeout: TIMEOUT });
            }
        });
    }
});

test('opens graph JSON source in the shared editor', async ({ page }) => {
    await page.goto('smoke/example.graph.json');
    await expect(page.locator('.graph-canvas')).toBeVisible({ timeout: TIMEOUT });
    const controls = page.getByRole('group', { name: 'Diagram controls' });
    await expect(controls.getByRole('button', { name: 'Run algorithms' })).toHaveCount(0);
    await controls.getByRole('button', { name: 'Edit File (JSON)' }).click();
    const editor = page.locator('.graph-code-editor .code-codemirror-editor .cm-content');
    await expect(editor).toBeVisible({ timeout: TIMEOUT });
    await expect(editor).toContainText('alpha');
    await expect(controls.getByRole('button', { name: 'Download SVG' })).toHaveCount(0);

    await page.getByRole('button', { name: 'View Diagram' }).click();
    const canvas = page.locator('.graph-canvas');
    const diagram = canvas.locator('.graph-svg');
    const width = () => diagram.evaluate(svg => svg.getBoundingClientRect().width);
    const original = await width();
    await canvas.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100 });
    await expect.poll(width).toBeCloseTo(original * 1.1, 0);
    await page.getByRole('button', { name: 'Reset zoom to 100%' }).click();
    await expect.poll(width).toBeCloseTo(original);
});

test('runs the Graph algorithms configured in the file', async ({ page, request }) => {
    const path = 'smoke/strategy.graph.json';
    const graph = {
        size: { width: 400, height: 300 },
        nodes: [{ id: 'idea', title: 'Idea', x: 40, y: 60, values: { cost: 10, benefit: 40 } }],
        edges: [],
        algorithms: ['strategy'],
    };
    const updated = await request.put(`${workerApi()}/update?path=${encodeURIComponent(path)}`, {
        multipart: { file: { name: 'strategy.graph.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(graph)) } },
    });
    expect(updated.ok()).toBeTruthy();

    await page.goto(path);
    const controls = page.getByRole('group', { name: 'Diagram controls' });
    await controls.getByRole('button', { name: 'Run algorithms' }).click();
    await controls.getByRole('button', { name: 'Edit File (JSON)' }).click();
    await expect(page.locator('.graph-code-editor .cm-content')).toContainText('"profitability": 30');
});

test('keeps the ArchDia controls with their diagram view and saves source edits', async ({ page, request }) => {
    const path = 'smoke/diagram.arch.md';
    await restoreFixture(request, path);
    await page.goto(path);
    const controls = page.getByRole('group', { name: 'Diagram controls' });
    const methods = controls.getByRole('button', { name: 'Show methods' });
    await expect(methods).toHaveAttribute('aria-pressed', 'true');
    await methods.click();
    await expect(methods).toHaveAttribute('aria-pressed', 'false');
    await expect(controls.getByRole('button', { name: 'PlantUML layout' })).toBeVisible();
    await expect(controls.getByRole('button', { name: 'Treemap layout' })).toBeVisible();

    await controls.getByRole('button', { name: 'Edit File (Raw)' }).click();
    const source = page.locator('.archdia-code-editor .cm-content');
    await expect(source).toBeVisible();
    await expect(source).toContainText('Alpha Component');
    await expect(methods).toHaveCount(0);
    await expect(controls.getByRole('button', { name: 'Copy source' })).toBeVisible();
    await expect(controls.getByRole('button', { name: 'Paste file' })).toBeVisible();
    const original = await (await request.get(fileUrl(path))).text();
    await source.fill(original.replace('Alpha Component', 'Renamed Component'));
    await expect.poll(async () => (await request.get(fileUrl(path))).text()).toContain('Renamed Component');

    await controls.getByRole('button', { name: 'View Diagram' }).click();
    await expect(page.locator('.archdia-svg')).toContainText('Renamed Component');
    await expect(methods).toHaveAttribute('aria-pressed', 'false');

    const nextTheme = await controls.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    await controls.getByRole('button', { name: `Switch to ${nextTheme} theme` }).click();
    await expect(controls).toHaveAttribute('data-theme', nextTheme);
});

test('opens the feature matrix and SVG source editors', async ({ page }) => {
    await page.goto('smoke/comparison.fmat.json');
    await page.getByRole('img', { name: 'code', exact: true }).click();
    await expect(page.locator('.code-codemirror-editor .cm-content')).toContainText('"features"');
    await page.getByRole('img', { name: 'table', exact: true }).click();
    await expect(page.locator('.fm-table')).toBeVisible();

    await page.goto('smoke/drawing.svg');
    const svgView = page.locator('.svg-view-control');
    await svgView.getByText('Source', { exact: true }).click();
    await expect(page.locator('.code-codemirror-editor .cm-content')).toContainText('<svg');
    await svgView.getByText('Canvas', { exact: true }).click();
});

test('opens the feature matrix scoring guide as a panel', async ({ page }) => {
    await page.goto('smoke/comparison.fmat.json');
    const help = page.getByRole('button', { name: 'How it works' });
    await expect(help).toBeVisible({ timeout: TIMEOUT });
    await help.click();
    await expect(page.locator('.fm-help-content')).toContainText('Scoring');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await help.click();
    await expect(page.locator('.fm-help-content')).toHaveCount(0);
});
