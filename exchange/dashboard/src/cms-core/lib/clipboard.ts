
export const setClipboard = async (content: string) => {
    return await navigator.clipboard.writeText(content);
}

/**
 * Strip HTML tags from a string to get plain text fallback
 */
const stripHtml = (html: string): string => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
};

/**
 * Copy HTML content to clipboard for pasting into Outlook and other rich text editors.
 * Provides both text/html and text/plain MIME types for maximum compatibility.
 */
export const setClipboardHtml = async (html: string, plainText?: string): Promise<void> => {
    const clipboardItem = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText ?? stripHtml(html)], { type: 'text/plain' })
    });
    return await navigator.clipboard.write([clipboardItem]);
};

// ──────────────────────────────────────────────────────────────────
// SVG → PNG clipboard helpers
// ──────────────────────────────────────────────────────────────────

/** Convert a Blob to a data: URL. */
function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Fetch all external `url()` references in CSS (fonts, images, etc.)
 * and replace them with inline data: URIs so the SVG is self-contained.
 */
async function inlineCssUrls(css: string): Promise<string> {
    const urlPattern = /url\(\s*["']?(https?:\/\/[^"')\s]+)["']?\s*\)/g;
    const fetched = new Map<string, string>();

    const matches = Array.from(css.matchAll(urlPattern));
    for (const m of matches) {
        const url = m[1];
        if (fetched.has(url)) continue;
        try {
            const res = await fetch(url, { mode: 'cors' });
            const blob = await res.blob();
            fetched.set(url, await blobToDataUrl(blob));
        } catch { /* leave original URL if unreachable */ }
    }

    let result = css;
    fetched.forEach((dataUrl, original) => {
        result = result.split(original).join(dataUrl);
    });
    return result;
}

/**
 * Extract readable text from a `<foreignObject>`, treating `<br>` and
 * block-level boundaries as line breaks.
 */
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

/**
 * Resolve the fill colour for a replacement `<text>` element by
 * inspecting inline styles and CSS rules in the parent SVG.
 */
function resolveFillColor(fo: Element, svg: Element): string {
    const foHtml = new XMLSerializer().serializeToString(fo);

    // 1. Inline style  color: …  on any child
    const inline = foHtml.match(/color\s*:\s*([^;"<]+)/i);
    if (inline) return inline[1].trim();

    // 2. Class-based lookup in the SVG <style> element
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

/**
 * Resolve font-size for the replacement `<text>` element.
 */
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

/**
 * Replace a `<foreignObject>` element with an SVG `<text>` element.
 * Browsers refuse to export canvases that contain `<foreignObject>` SVGs
 * ("tainted canvas"), so this conversion is needed for rasterization.
 */
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

/**
 * Inline external `href` / `xlink:href` on SVG `<image>` elements.
 */
async function inlineImageElement(img: Element) {
    const href = img.getAttribute('href') ||
        img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (!href || !/^https?:\/\//.test(href)) return;
    try {
        const res = await fetch(href, { mode: 'cors' });
        const blob = await res.blob();
        const dataUrl = await blobToDataUrl(blob);
        img.setAttribute('href', dataUrl);
        if (img.hasAttributeNS('http://www.w3.org/1999/xlink', 'href')) {
            img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', dataUrl);
        }
    } catch { /* keep original href */ }
}

/**
 * Prepare an SVG string for canvas-based rasterization:
 *  • inline external CSS URL references (fonts, images)
 *  • replace `<foreignObject>` with SVG `<text>` (prevents tainted canvas)
 *  • inline external `<image>` hrefs
 */
async function prepareSvgForRasterization(svgString: string): Promise<string> {
    const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
    const svg = doc.documentElement;

    if (!svg.getAttribute('xmlns')) {
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }

    // Inline external font / image URLs in CSS
    for (const style of Array.from(svg.querySelectorAll('style'))) {
        style.textContent = await inlineCssUrls(style.textContent || '');
    }

    // Remove <foreignObject> – main source of "tainted canvas" errors
    for (const fo of Array.from(svg.querySelectorAll('foreignObject'))) {
        replaceForeignObject(fo, doc, svg);
    }

    // Inline external images
    for (const imgEl of Array.from(svg.querySelectorAll('image'))) {
        await inlineImageElement(imgEl);
    }

    return new XMLSerializer().serializeToString(svg);
}

/**
 * Rasterize an SVG string to PNG and write it to the clipboard as an image.
 * The SVG is first sanitized (external resources inlined, `<foreignObject>`
 * converted to native SVG `<text>`) so that the canvas is never tainted.
 * The result can be pasted directly into Confluence pages, Outlook e-mails, etc.
 */
export const setClipboardImageFromSvg = async (svgString: string, scale = 2): Promise<void> => {
    // Sanitize so the canvas is never tainted
    const safeSvg = await prepareSvgForRasterization(svgString);

    const svgEl = new DOMParser().parseFromString(safeSvg, 'image/svg+xml').documentElement;

    let width = 0;
    let height = 0;

    // Only accept explicit pixel values (skip percentages like "100%")
    const rawW = svgEl.getAttribute('width') || '';
    const rawH = svgEl.getAttribute('height') || '';
    if (rawW && !/[%a-z]/i.test(rawW)) width = parseFloat(rawW) || 0;
    if (rawH && !/[%a-z]/i.test(rawH)) height = parseFloat(rawH) || 0;

    // Prefer viewBox for missing dimensions
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

    // Try max-width from inline style as a last resort
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

        // White background for clean paste in Confluence / Outlook
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        ctx.drawImage(img, 0, 0, width, height);

        const pngBlob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Failed to create PNG blob')), 'image/png');
        });

        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
    } finally {
        URL.revokeObjectURL(url);
    }
};

export const getClipboardText = async (): Promise<string> => {
    try {
        return await navigator.clipboard.readText();
    } catch (error) {
        console.error("Please allow clipboard access in your browser.");
        throw error;
    }
}

export const getClipboardImage = async (): Promise<string | undefined> => {
    try {
        const clipboardItems = await navigator.clipboard.read();

        for (const clipboardItem of clipboardItems) {
            for (const type of clipboardItem.types) {
                if (type.startsWith("image/")) {
                    const blob = await clipboardItem.getType(type);

                    return await resizeImageToBase64(blob, 1000, 1000);
                }
            }
        }
    } catch (error) {
        console.error("Please allow clipboard access in your browser.");
        throw error;
    }
}

function resizeImageToBase64(blob: Blob, boxWidth: number, boxHeight: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = function () {
            const w = boxWidth / img.width;
            const h = boxHeight / img.height;
            const r = Math.min(Math.min(w, h), 1.0);

            const width = img.width * r;
            const height = img.height * r;

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            canvas.width = width;
            canvas.height = height;

            ctx!.drawImage(img, 0, 0, width, height);

            resolve(canvas.toDataURL());
        };

        img.onerror = function () {
            reject("Failed to load image from blob.");
        };

        img.src = URL.createObjectURL(blob);
    });
}
