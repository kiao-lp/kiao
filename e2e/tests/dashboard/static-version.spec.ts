import { test, expect, workerApi, fileUrl } from '../harness';

/**
 * E2E: generate the static version of a `.src.md`.
 *
 * A `.src.md` is an ordinary markdown document that declares its own generated output. The
 * contextual menu draws its diagrams — with the renderers this tab already has loaded — writes one
 * SVG per diagram into a sibling asset folder, and writes the document beside the source with
 * `.src` taken out. What is verified here is the part no unit test can see: that the entry is
 * offered on the right file, that the pictures come out of the real renderers rather than a stub,
 * and that everything which is not a diagram survives the trip untouched.
 *
 * PlantUML is deliberately absent from the fixture: no render server runs in this environment, and
 * a diagram that cannot be drawn is covered by the unit tests instead.
 */

const TIMEOUT = 30000;
const SOURCE = 'smoke/static-version.src.md';
const OUTPUT = 'smoke/static-version.md';
const ASSETS = 'smoke/static-version.assets';

const listUrl = (path: string) => `${workerApi()}/list?path=${encodeURIComponent(path)}`;

test('generates a static version, replacing every diagram with a picture', async ({ page, request }) => {
    await page.goto('smoke');
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });

    const row = page.getByTestId(`browser-item-${SOURCE}`);
    await expect(row).toBeVisible({ timeout: TIMEOUT });

    // The entry is offered on a `.src.md`…
    await row.click({ button: 'right' });
    const entry = page.getByRole('menuitem', { name: 'Generate static version' });
    await expect(entry).toBeVisible({ timeout: TIMEOUT });
    await entry.click();

    // …and the run reports what it wrote, once every diagram is drawn.
    await expect(page.locator('.ant-message-success')).toContainText('static-version.md', { timeout: TIMEOUT });

    const generated = await (await request.get(fileUrl(OUTPUT))).text();

    // One picture per diagram, numbered in document order and named by language.
    expect(generated).toContain('![Mermaid diagram 1](static-version.assets/01-mermaid.svg)');
    expect(generated).toContain('![ArchDia diagram 2](static-version.assets/02-archdia.svg)');
    expect(generated).toContain('![Graph diagram 3](static-version.assets/03-graph.svg)');
    expect(generated).toContain('![SVG image 4](static-version.assets/04-svg.svg)');

    // Nothing that was not a diagram was touched — prose, source code, and a diagram
    // quoted inside a longer fence as an example of one.
    expect(generated).toContain('A prose paragraph before the diagrams.');
    expect(generated).toContain('A prose paragraph between the diagrams.');
    expect(generated).toContain('A prose paragraph after the diagrams.');
    expect(generated).toContain('```ts\nconst answer = 42;\n```');
    expect(generated).toContain('````markdown\n```mermaid\ngraph TD;\n  Quoted-->Example;\n```\n````');

    // No diagram source is left in the generated file: the four fences are gone.
    expect(generated).not.toContain('```archdia');
    expect(generated).not.toContain('```graph');
    expect(generated).not.toContain('```svg');

    // The source is left exactly as it was — a generation reads it and writes elsewhere.
    const source = await (await request.get(fileUrl(SOURCE))).text();
    expect(source).toContain('```mermaid');
    expect(source).toContain('`````archdia');

    // The pictures are on disk, and are pictures: real renderer output, not a placeholder.
    const listed = await (await request.get(listUrl(ASSETS))).json();
    expect(listed.map((f: { path: string }) => f.path.split('/').pop()).sort())
        .toEqual(['01-mermaid.svg', '02-archdia.svg', '03-graph.svg', '04-svg.svg']);

    const mermaidSvg = await (await request.get(fileUrl(`${ASSETS}/01-mermaid.svg`))).text();
    expect(mermaidSvg).toContain('<svg');
    expect(mermaidSvg).toContain('Alpha');
    expect(mermaidSvg).toContain('Beta');
    // Flattened for an <img> context, where a browser lays out no HTML at all.
    expect(mermaidSvg).not.toContain('<foreignObject');

    const archdiaSvg = await (await request.get(fileUrl(`${ASSETS}/02-archdia.svg`))).text();
    expect(archdiaSvg).toContain('Alpha Component');
    expect(archdiaSvg).not.toContain('<foreignObject');

    const graphSvg = await (await request.get(fileUrl(`${ASSETS}/03-graph.svg`))).text();
    expect(graphSvg).toContain('<svg');
    expect(graphSvg).not.toContain('<foreignObject');

    // The generated markdown renders in the CMS with its pictures resolved from the store, against
    // the folder of the document — which is what the relative links written here mean. The src is
    // what is asserted rather than the count: an <img> is in the DOM whether or not its src answers,
    // so four of them were counted even while all four were fetched from the store root and 404ed.
    await page.goto(OUTPUT);
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });
    const pictures = page.locator('.configured-markdown-container img');
    await expect(pictures).toHaveCount(4, { timeout: TIMEOUT });
    const sources = await pictures.evaluateAll(imgs => imgs.map(img => (img as HTMLImageElement).src));
    for (const src of sources) {
        expect(decodeURIComponent(src)).toContain(`path=${ASSETS}/`);
    }
});

test('offers the entry on a .src.md only', async ({ page }) => {
    await page.goto('smoke');
    await expect(page.locator('.cms-top-banner')).toBeVisible({ timeout: TIMEOUT });

    const plainMarkdown = page.getByTestId('browser-item-smoke/roundtrip.md');
    await expect(plainMarkdown).toBeVisible({ timeout: TIMEOUT });
    await plainMarkdown.click({ button: 'right' });

    // The menu is open — it just does not carry this entry.
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible({ timeout: TIMEOUT });
    await expect(page.getByRole('menuitem', { name: 'Generate static version' })).toHaveCount(0);
});
