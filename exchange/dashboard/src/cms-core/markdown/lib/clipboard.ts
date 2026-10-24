const stripHtml = (html: string): string => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
};

export const setClipboardHtml = async (html: string, plainText?: string): Promise<void> => {
    const clipboardItem = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText ?? stripHtml(html)], { type: 'text/plain' }),
    });
    return await navigator.clipboard.write([clipboardItem]);
};

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export interface PrepareSvgOptions {
    /** Portable exports must fail instead of leaving inaccessible resources in the picture. */
    strict?: boolean;
    resolveResource?: (url: string) => Promise<Blob>;
}

async function resourceDataUrl(url: string, options: PrepareSvgOptions): Promise<string> {
    if (options.resolveResource) return blobToDataUrl(await options.resolveResource(url));
    const response = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`SVG resource answered ${response.status}: ${url}`);
    return blobToDataUrl(await response.blob());
}

async function inlineCssUrls(css: string, options: PrepareSvgOptions): Promise<string> {
    const urlPattern = /url\(\s*["']?([^"')\s]+)["']?\s*\)/g;
    const fetched = new Map<string, string>();

    const matches = Array.from(css.matchAll(urlPattern));
    for (const m of matches) {
        const url = m[1];
        if (url.startsWith('#') || url.startsWith('data:')) continue;
        if (!options.strict && !options.resolveResource && !/^https?:\/\//.test(url)) continue;
        if (fetched.has(url)) continue;
        try {
            fetched.set(url, await resourceDataUrl(url, options));
        } catch (error) { if (options.strict) throw error; }
    }

    let result = css;
    fetched.forEach((dataUrl, original) => {
        result = result.split(original).join(dataUrl);
    });
    return result;
}

function extractText(fo: Element): string {
    const html = new XMLSerializer().serializeToString(fo);
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/div>\s*<div/gi, '\n<div')
        .replace(/<\/p>\s*<p/gi, '\n<p')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim();
}

function resolveFillColor(fo: Element, svg: Element): string {
    const foHtml = new XMLSerializer().serializeToString(fo);

    const inline = foHtml.match(/color\s*:\s*([^;"<]+)/i);
    if (inline) return inline[1].trim();

    const cssText = svg.querySelector('style')?.textContent || '';
    const classAttr = foHtml.match(/class\s*=\s*"([^"]+)"/);
    if (classAttr) {
        for (const cls of classAttr[1].split(/\s+/)) {
            const re = new RegExp(`\\.${cls}\\b[^{]*\\{[^}]*?\\bcolor\\s*:\\s*([^;}"']+)`, 'i');
            const hit = cssText.match(re);
            if (hit) return hit[1].trim();
        }
    }

    return 'currentColor';
}

function resolveFontSize(fo: Element, svg: Element): number {
    const foHtml = new XMLSerializer().serializeToString(fo);

    const inlineMatch = foHtml.match(/font-size\s*:\s*(\d+)/i);
    if (inlineMatch) return parseInt(inlineMatch[1], 10);

    const cssText = svg.querySelector('style')?.textContent || '';
    const classAttr = foHtml.match(/class\s*=\s*"([^"]+)"/);
    if (classAttr) {
        for (const cls of classAttr[1].split(/\s+/)) {
            const re = new RegExp(`\\.${cls}\\b[^{]*\\{[^}]*?font-size\\s*:\\s*(\\d+)`, 'i');
            const hit = cssText.match(re);
            if (hit) return parseInt(hit[1], 10);
        }
    }

    return 14;
}

function replaceForeignObject(fo: Element, doc: Document, svg: Element) {
    const parent = fo.parentNode;
    if (!parent) return;

    const text = extractText(fo);
    if (!text) { parent.removeChild(fo); return; }

    const x = parseFloat(fo.getAttribute('x') || '0');
    const y = parseFloat(fo.getAttribute('y') || '0');
    const w = parseFloat(fo.getAttribute('width') || '200');
    const h = parseFloat(fo.getAttribute('height') || '50');

    const fontSize = resolveFontSize(fo, svg);
    const fill = resolveFillColor(fo, svg);

    const textEl = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
    textEl.setAttribute('text-anchor', 'middle');
    textEl.setAttribute('dominant-baseline', 'central');
    textEl.setAttribute('font-family', '"trebuchet ms", verdana, arial, sans-serif');
    textEl.setAttribute('font-size', String(fontSize));
    textEl.setAttribute('fill', fill);

    const lines = text.split('\n').filter(l => l.trim());
    const lineHeight = fontSize * 1.2;

    if (lines.length <= 1) {
        textEl.setAttribute('x', String(x + w / 2));
        textEl.setAttribute('y', String(y + h / 2));
        textEl.textContent = lines[0] || text;
    } else {
        const totalH = lines.length * lineHeight;
        const startY = y + h / 2 - totalH / 2 + lineHeight / 2;
        for (let i = 0; i < lines.length; i++) {
            const tspan = doc.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            tspan.setAttribute('x', String(x + w / 2));
            tspan.setAttribute('y', String(startY + i * lineHeight));
            tspan.textContent = lines[i].trim();
            textEl.appendChild(tspan);
        }
    }

    parent.replaceChild(textEl, fo);
}

async function inlineImageElement(img: Element, options: PrepareSvgOptions) {
    const href = img.getAttribute('href') ||
        img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (!href || /^(data:|#)/.test(href)) return;
    if (!options.strict && !options.resolveResource && !/^https?:\/\//.test(href)) return;
    try {
        const dataUrl = await resourceDataUrl(href, options);
        img.setAttribute('href', dataUrl);
        if (img.hasAttributeNS('http://www.w3.org/1999/xlink', 'href')) {
            img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', dataUrl);
        }
    } catch (error) { if (options.strict) throw error; }
}

/**
 * Makes an SVG stand on its own, outside the page that drew it.
 *
 * Three things keep a rendered diagram tied to its host: CSS `url()` references and `<image>`
 * hrefs that only resolve against the app's origin, and `<foreignObject>`, whose HTML is laid out
 * by the browser only when the SVG is part of a document. An `<img src="diagram.svg">` — which is
 * what a markdown image is — is *not* part of a document, so every foreignObject label would
 * simply be blank. Flattening them to native `<text>` is what makes the labels survive the trip;
 * it is equally what a rasterizer needs, which is why the clipboard and the static export share
 * this function.
 */
export async function prepareSvg(svgString: string, options: PrepareSvgOptions = {}): Promise<string> {
    const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
    const svg = doc.documentElement;
    if (options.strict && (svg.localName !== 'svg' || doc.querySelector('parsererror'))) {
        throw new Error('Invalid SVG');
    }

    if (!svg.getAttribute('xmlns')) {
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }

    for (const style of Array.from(svg.querySelectorAll('style'))) {
        if (options.strict && /@import/i.test(style.textContent || '')) throw new Error('SVG CSS imports are not supported');
        style.textContent = await inlineCssUrls(style.textContent || '', options);
    }

    for (const element of Array.from(svg.querySelectorAll('*')).concat(svg)) {
        for (const attribute of Array.from(element.attributes)) {
            if (attribute.value.includes('url(')) element.setAttribute(attribute.name, await inlineCssUrls(attribute.value, options));
        }
    }

    for (const fo of Array.from(svg.querySelectorAll('foreignObject'))) {
        if (options.strict && fo.querySelector('img, svg, video, canvas')) throw new Error('SVG HTML labels contain unsupported images');
        replaceForeignObject(fo, doc, svg);
    }

    for (const imgEl of Array.from(svg.querySelectorAll('image'))) {
        await inlineImageElement(imgEl, options);
    }

    return new XMLSerializer().serializeToString(svg);
}

/** Rasterize an already-prepared SVG to a PNG blob at `scale`x on white. */
async function svgToPngBlob(safeSvg: string, scale: number): Promise<Blob> {
    const svgEl = new DOMParser().parseFromString(safeSvg, 'image/svg+xml').documentElement;

    let width = 0;
    let height = 0;

    const rawW = svgEl.getAttribute('width') || '';
    const rawH = svgEl.getAttribute('height') || '';
    if (rawW && !/[%a-z]/i.test(rawW)) width = parseFloat(rawW) || 0;
    if (rawH && !/[%a-z]/i.test(rawH)) height = parseFloat(rawH) || 0;

    if (!width || !height) {
        const vb = svgEl.getAttribute('viewBox');
        if (vb) {
            const p = vb.split(/[\s,]+/).map(parseFloat);
            if (p.length === 4) {
                width = width || p[2];
                height = height || p[3];
            }
        }
    }

    if (!width) {
        const style = svgEl.getAttribute('style') || '';
        const mw = style.match(/max-width\s*:\s*(\d+(?:\.\d+)?)\s*px/i);
        if (mw) width = parseFloat(mw[1]);
    }

    if (!width || !height) { width = 800; height = 600; }

    const url = URL.createObjectURL(new Blob([safeSvg], { type: 'image/svg+xml;charset=utf-8' }));
    try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Failed to load SVG for rasterization'));
            img.src = url;
        });

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        ctx.scale(scale, scale);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        ctx.drawImage(img, 0, 0, width, height);

        return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Failed to create PNG blob')), 'image/png');
        });
    } finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * Copy a diagram to the clipboard as a vector SVG, with a rasterized PNG in the
 * same clipboard item. Vector tools (Figma, Illustrator, Inkscape, draw.io)
 * paste the SVG; apps that only accept bitmaps (Outlook, Confluence, Word,
 * Slack) fall back to the PNG. The SVG is made self-contained first (CSS urls
 * and <image> hrefs inlined, foreignObject flattened to native <text>).
 */
export const setClipboardSvg = async (svgString: string, scale = 2): Promise<void> => {
    const safeSvg = await prepareSvg(svgString);
    const svgBlob = new Blob([safeSvg], { type: 'image/svg+xml' });
    const pngBlob = await svgToPngBlob(safeSvg, scale);

    try {
        // Vector + raster together: each target picks the format it supports.
        await navigator.clipboard.write([
            new ClipboardItem({ 'image/svg+xml': svgBlob, 'image/png': pngBlob }),
        ]);
    } catch {
        try {
            // Browser rejects image/svg+xml on the async clipboard (e.g. Chrome
            // rejects the whole item) → keep the PNG so it still pastes.
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': pngBlob }),
            ]);
        } catch {
            // Last resort: SVG markup as HTML + plain text.
            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([safeSvg], { type: 'text/html' }),
                    'text/plain': new Blob([safeSvg], { type: 'text/plain' }),
                }),
            ]);
        }
    }
};

/**
 * Copy a diagram to the clipboard as a rasterized PNG only. The SVG is made
 * self-contained, then drawn onto a canvas at `scale`x on a white background.
 */
export const setClipboardPng = async (svgString: string, scale = 2): Promise<void> => {
    const safeSvg = await prepareSvg(svgString);
    const pngBlob = await svgToPngBlob(safeSvg, scale);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
};
