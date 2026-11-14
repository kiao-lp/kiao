import { test, expect, workerApi, fileUrl } from '../harness';

const server = process.env.E2E_PLANTUML_URL;
test.skip(!server, 'E2E_PLANTUML_URL and VITE_PLANTUML_SERVER_URL must name a running render server');

const source = 'smoke/plantuml-server.src.md';
const diagrams = [
    '@startuml\nAlice -> Bob : Bonjour été\n@enduml',
    '@startuml\ncomponent "Dashboard" as D\ndatabase "Store" as S\nD --> S\n@enduml',
    '@startuml\n!include <C4/C4_Container>\nPerson(user, "Lecteur")\nContainer(app, "Application", "Web")\nRel(user, app, "Consulte")\n@enduml',
];

test('renders PlantUML images and exports real SVGs from Dashboard', async ({ page, request }) => {
    const markdown = '# PlantUML\n\n' + diagrams.map(code => '```plantuml\n' + code + '\n```').join('\n\n');
    const saved = await request.put(`${workerApi()}/update?path=${source}`, {
        multipart: { file: { name: 'plantuml-server.src.md', mimeType: 'text/plain', buffer: Buffer.from(markdown) } },
    });
    expect(saved.ok()).toBeTruthy();

    await page.goto(source);
    const images = page.locator('img[data-plantuml-source]');
    await expect(images).toHaveCount(3);
    for (const image of await images.all()) {
        await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        const url = await image.getAttribute('src');
        expect(url).toMatch(new RegExp('^' + server!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/svg/'));
        const response = await request.get(url!);
        expect(response.status()).toBe(200);
        expect(await response.text()).not.toMatch(/Syntax Error|Cannot include|GraphViz has crashed/);
    }

    const printing = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: 'PDF', exact: true }).click();
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    const printPage = await printing;
    const printImages = printPage.locator('img[data-plantuml-source]');
    await expect(printImages).toHaveCount(3);
    for (const image of await printImages.all()) {
        await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        expect(await image.getAttribute('src')).toContain(server + '/svg/');
    }
    await printPage.close();

    await page.goto('smoke');
    await page.getByTestId(`browser-item-${source}`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Generate static version' }).click();
    await expect(page.locator('.ant-message-success')).toContainText('plantuml-server.md', { timeout: 30000 });
    const generated = await (await request.get(fileUrl('smoke/plantuml-server.md'))).text();
    expect(generated).not.toContain('```plantuml');
    for (const [i, label] of ['Bonjour', 'Dashboard', 'Lecteur'].entries()) {
        const asset = `smoke/plantuml-server.assets/0${i + 1}-plantuml.svg`;
        const response = await request.get(fileUrl(asset));
        expect(response.ok()).toBeTruthy();
        const svg = await response.text();
        expect(svg).toContain('</svg>');
        expect(svg).toContain(label);
        expect(svg).not.toMatch(/Syntax Error|Cannot include|GraphViz has crashed/);
    }
});
