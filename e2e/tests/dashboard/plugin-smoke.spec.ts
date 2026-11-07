import { test, expect } from '../harness';

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
    /** Fixture path relative to the worker root (and to the app base URL). */
    path: string;
    /** Stable selector proving this plugin's main view rendered. */
    selector: string;
    /** Filename (without extension) the plugin sets as document.title once mounted.
     *  The template plugin renders an instantiation view and titles nothing, so it has none. */
    title?: string;
};

// Types with a distinctive main-view selector. `.cm-editor` is shared by the
// three CodeMirror-based editors; the navigated extension + the document title
// (which each plugin's MainView sets from the file name) disambiguates them.
const cases: PluginCase[] = [
    { name: 'markdown (.md)', path: 'welcome.md', selector: '.cm-editor', title: 'welcome' },
    { name: 'text (.txt)', path: 'smoke/sample.txt', selector: '.cm-editor', title: 'sample' },
    { name: 'tabular text (.csv)', path: 'smoke/rows.csv', selector: '.cm-editor', title: 'rows' },
    { name: 'code / JSON (.json)', path: 'smoke/data.json', selector: '.cm-editor', title: 'data' },
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
            await expect(page.locator(c.selector).first()).toBeVisible({ timeout: TIMEOUT });
            if (c.title) await expect(page).toHaveTitle(c.title, { timeout: TIMEOUT });
        });
    }
});

test('opens graph JSON source in the shared editor', async ({ page }) => {
    await page.goto('smoke/example.graph.json');
    await expect(page.locator('.graph-canvas')).toBeVisible({ timeout: TIMEOUT });
    await page.locator('.graph-toolbar-btn').nth(1).click();
    const editor = page.locator('.graph-code-editor .code-codemirror-editor .cm-content');
    await expect(editor).toBeVisible({ timeout: TIMEOUT });
    await expect(editor).toContainText('alpha');
});
