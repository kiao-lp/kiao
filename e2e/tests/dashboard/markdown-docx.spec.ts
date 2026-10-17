import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { test, expect, workerApi, type Page, type APIRequestContext } from '../harness';

const FILE = 'smoke/word-export.md';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const PLANT = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160"><rect width="320" height="160" fill="white"/><text x="10" y="30">PlantUML — Élève &amp; café</text></svg>';
const source = `# Édition & caractères < > « Word »

Avant Mermaid. **Gras** et *italique*, ~~barré~~, [Lien externe](https://example.com/a?b=1&c=2).

~~~mermaid
flowchart LR
  A[Élève] --> B[Café]
~~~

Après Mermaid, avant PlantUML.

\`\`\`plantuml
@startuml
Alice -> Bob : café
@enduml
\`\`\`

Après PlantUML, avant ArchDia.

\`\`\`\`\`archdia
---
type: PLANTUML
---
\`\`\`plantuml
@startuml
component "Alpha Component"
component "Beta Component"
@enduml
\`\`\`
===
---
type: LAYOUT
---
\`\`\`json
{"size":{"width":640,"height":480},"positions":{"Alpha Component":{"x":40,"y":40},"Beta Component":{"x":300,"y":40}}}
\`\`\`
\`\`\`\`\`

Après ArchDia, avant Graph.

> \`\`\`graph
> {"size":{"width":400,"height":300},"nodes":[{"id":"a","title":"Graph Alpha","x":40,"y":60},{"id":"b","title":"Graph Beta","x":220,"y":140}],"edges":[{"from":"a","to":"b"}]}
> \`\`\`

Après Graph, avant SVG.

<!-- kiao:diagram
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="8000" viewBox="0 0 4000 8000"><style>:root { --ink: #123456 } .label { fill: var(--ink); }</style><rect width="4000" height="8000" fill="white"/><text class="label" x="20" y="80" font-size="40">SVG géant</text><image href="word-pixel.png" width="20" height="20"/></svg>
\`\`\`
-->
![Ancien rendu](missing-companion.svg)

Après SVG.

| Nom | Valeur |
| --- | --- |
| Café & thé | 42 < 100 |

3. Premier
4. Second
   - Sous-liste

- Liste simple
- Deuxième

![Pixel relatif](word-pixel.png)
![Pixel racine](/smoke/word-pixel.png)

\`\`\`ts
const café = "<&>";
  // indentation conservée
\`\`\`

\`\`\`\`markdown
\`\`\`mermaid
quoted example
\`\`\`
\`\`\`\`

Dernier paragraphe.
`;

async function write(request: APIRequestContext, path: string, content: string | Buffer) {
    const response = await request.put(`${workerApi()}/update?path=${encodeURIComponent(path)}`, {
        multipart: { file: { name: path.split('/').pop()!, mimeType: 'application/octet-stream', buffer: Buffer.from(content) } },
    });
    expect(response.ok()).toBeTruthy();
}
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
const elements = (xml: Document | Element, tag: string): Element[] => Array.from(xml.getElementsByTagName(tag));

async function openWordExport(page: Page) {
    // The previous dialog's close animation still holds its Export button for a moment.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: 'Word (.docx)', exact: true }).click();
    return dialog;
}

async function downloadedDocx(page: Page) {
    const dialog = await openWordExport(page);
    const ready = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await ready;
    expect(download.suggestedFilename()).toBe('word-export.docx');
    const path = await download.path();
    expect(path).toBeTruthy();
    return JSZip.loadAsync(await readFile(path!));
}

test.afterEach(async ({ request }) => {
    for (const path of [FILE, 'smoke/word-pixel.png']) await request.delete(`${workerApi()}/delete?path=${encodeURIComponent(path)}`);
});

test('downloads native Word text and ordered, self-contained vector diagrams from unsaved source without a preview', async ({ page, request }) => {
    test.setTimeout(120000);
    let plantRequests = 0;
    let releasePlant!: () => void;
    const plantGate = new Promise<void>(resolve => { releasePlant = resolve; });
    // A deterministic render server response: nothing goes to the public PlantUML service.
    await page.route('**/svg/*', async route => {
        plantRequests++;
        if (route.request().resourceType() === 'fetch') await plantGate;
        await route.fulfill({ contentType: 'image/svg+xml', body: PLANT });
    });
    await write(request, FILE, source);
    await write(request, 'smoke/word-pixel.png', PNG);
    await page.goto(FILE);
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 30000 });
    // This also checks the toolbar action is present in the compiled assembly (E2E_BUILT=1).
    await page.locator('button:has(.anticon-eye)').click();
    await expect(page.locator('.configured-markdown-container')).toHaveCount(0);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    // Host-only CSS must never recolor SVGs exported on paper.
    await page.addStyleTag({ content: 'svg text { fill: rgb(255, 0, 0) !important; }' });
    // Keep autosave pending for the entire conversion; only the controlled editor has this text.
    let releaseSave!: () => void;
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    await page.route('**/update?**', async route => { await saveGate; await route.continue(); });
    try {
        await page.locator('.cm-content').click();
        await page.keyboard.press('Control+End');
        await page.keyboard.insertText('\n\nAjout non enregistré — été € & < >.');
        const downloading = downloadedDocx(page);
        await expect(page.locator('.ant-message-loading')).toContainText('Rendering diagram 2 of 5');
        releasePlant();
        const zip = await downloading;
        await expect(page.locator('.ant-message-success')).toContainText('Word document downloaded');
        expect(plantRequests).toBeGreaterThan(0);
        const stored = await (await request.get(`${workerApi()}/getFile?path=${FILE}`)).text();
        expect(stored).not.toContain('Ajout non enregistré');

        const document = parse(await zip.file('word/document.xml')!.async('string'));
        const rels = parse(await zip.file('word/_rels/document.xml.rels')!.async('string'));
        const relationships = new Map(elements(rels, 'Relationship').map(rel => [rel.getAttribute('Id'), rel]));
        const text = elements(document, 'w:t').map(node => node.textContent).join(' ');
        for (const expected of ['Édition & caractères < > « Word »', 'Ajout non enregistré — été € & < >.', 'Café & thé', 'const café = "<&>";', '  // indentation conservée', 'quoted example']) expect(text).toContain(expected);
        expect(elements(document, 'w:tbl')).toHaveLength(1);
        expect(elements(document, 'w:pStyle').some(el => el.getAttribute('w:val') === 'Heading1')).toBeTruthy();
        expect(elements(document, 'w:numPr').length).toBeGreaterThanOrEqual(5);
        expect(await zip.file('word/numbering.xml')!.async('string')).toContain('w:val="3"');
        const link = elements(document, 'w:hyperlink')[0];
        expect(relationships.get(link.getAttribute('r:id'))?.getAttribute('Target')).toBe('https://example.com/a?b=1&c=2');

        const events: string[] = [];
        for (const paragraph of elements(document, 'w:p')) {
            const text = elements(paragraph, 'w:t').map(el => el.textContent).join('');
            if (text) events.push(text);
            for (const svgBlip of elements(paragraph, 'asvg:svgBlip')) {
                const rel = relationships.get(svgBlip.getAttribute('r:embed'))!;
                expect(rel).toBeTruthy();
                expect(rel.getAttribute('TargetMode')).not.toBe('External');
                const target = rel.getAttribute('Target')!;
                expect(target).toMatch(/^media\/.+\.svg$/);
                const svg = await zip.file(`word/${target}`)!.async('string');
                const parsedSvg = parse(svg).documentElement;
                const contentLabels = ['Élève', 'PlantUML — Élève', 'Alpha Component', 'Graph Alpha', 'SVG géant'];
                expect(svg).toContain(contentLabels[events.filter(value => /^(mermaid|plantuml|archdia|graph|svg) #/.test(value)).length]);
                expect(parsedSvg.tagName).toBe('svg');
                expect(svg).not.toMatch(/foreignObject|var\(/);
                expect(svg).not.toContain('fill: rgb(255, 0, 0)');
                expect(Number(parsedSvg.getAttribute('width'))).toBeGreaterThan(0);
                expect(Number(parsedSvg.getAttribute('height'))).toBeGreaterThan(0);
                for (const image of elements(parsedSvg, 'image')) expect(image.getAttribute('href')).toMatch(/^data:/);
                const label = elements(paragraph, 'wp:docPr')[0].getAttribute('descr')!;
                events.push(label);
                const extent = elements(paragraph, 'wp:extent')[0];
                const width = Number(extent.getAttribute('cx'));
                const height = Number(extent.getAttribute('cy'));
                expect(width).toBeLessThanOrEqual(6120001); // 17 cm in EMU
                expect(height).toBeLessThanOrEqual(9252001); // 25.7 cm
                expect(width / height).toBeCloseTo(Number(parsedSvg.getAttribute('width')) / Number(parsedSvg.getAttribute('height')), 3);
                if (label === 'svg #5') {
                    expect(width / height).toBeCloseTo(0.5, 4);
                    expect(svg).toContain('SVG géant');
                    expect(svg).toMatch(/fill:\s*rgb\(18, 52, 86\)/);
                }
                // The PNG fallback also resolves to an actual package part, never a server URL.
                const fallback = elements(paragraph, 'a:blip')[0];
                const fallbackTarget = relationships.get(fallback.getAttribute('r:embed'))!.getAttribute('Target')!;
                expect(await zip.file(`word/${fallbackTarget}`)!.async('uint8array')).not.toHaveLength(0);
            }
        }
        expect(events.filter(value => /^(mermaid|plantuml|archdia|graph|svg) #/.test(value)))
            .toEqual(['mermaid #1', 'plantuml #2', 'archdia #3', 'graph #4', 'svg #5']);
        const positions = ['Avant Mermaid.', 'mermaid #1', 'Après Mermaid, avant PlantUML.', 'plantuml #2', 'Après PlantUML, avant ArchDia.', 'archdia #3', 'Après ArchDia, avant Graph.', 'graph #4', 'Après Graph, avant SVG.', 'svg #5', 'Après SVG.']
            .map(marker => events.findIndex(value => value.startsWith(marker)));
        expect(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]))).toBeTruthy();
        expect(elements(document, 'asvg:svgBlip')).toHaveLength(5);
        expect(elements(document, 'w:drawing')).toHaveLength(7);
        expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('image/svg+xml');
        expect(Object.keys(zip.files).some(path => path.endsWith('.html'))).toBeFalsy();
    } finally { releaseSave(); releasePlant(); }
});

test('reports a failed diagram and downloads no incomplete document; the next export can succeed', async ({ page, request }) => {
    await write(request, FILE, '# Document\n\n```plantuml\n@startuml\nAlice -> Bob\n@enduml\n```');
    await page.route('**/svg/*', route => route.fulfill({ status: 503, body: 'Fixture unavailable' }));
    await page.goto(FILE);
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 30000 });
    const downloads: string[] = [];
    page.on('download', download => downloads.push(download.suggestedFilename()));
    const failedDialog = await openWordExport(page);
    await failedDialog.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.locator('.ant-message-error')).toContainText('Diagram plantuml #1 failed: PlantUML server answered 503');
    expect(downloads).toEqual([]);
    // The toast pauses its dismissal while hovered, and the click left the mouse under it:
    // move on so its 10 seconds run and the retry below can land.
    await page.mouse.move(8, 8);
    await expect(page.locator('.ant-message-error')).toHaveCount(0, { timeout: 30000 });
    await page.unroute('**/svg/*');
    await page.route('**/svg/*', route => route.fulfill({ contentType: 'image/svg+xml', body: PLANT }));
    const zip = await downloadedDocx(page);
    expect(await zip.file('word/document.xml')!.async('string')).toContain('asvg:svgBlip');
});
