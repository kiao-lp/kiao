import { ImageRun } from 'docx';
import { prepareSvg } from './lib/clipboard';
import { withIntrinsicSize } from './static/intrinsicSize';

/** A4, 20 mm margins. Pixels are converted by docx at 96 dpi. */
export const WORD_CONTENT_WIDTH = (210 - 40) * 96 / 25.4;
// Leave room for the image paragraph's baseline and spacing as well as the drawing itself.
export const WORD_CONTENT_HEIGHT = (297 - 40 - 8) * 96 / 25.4;

export function fitWordImage(width: number, height: number, maxWidth = WORD_CONTENT_WIDTH) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error('Image has no usable dimensions');
    }
    const scale = Math.min(1, maxWidth / width, WORD_CONTENT_HEIGHT / height);
    return { width: width * scale, height: height * scale };
}

const SVG_STYLE_PROPERTIES = [
    'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
    'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
    'opacity', 'color', 'font-family', 'font-size', 'font-weight', 'font-style',
    'text-anchor', 'dominant-baseline', 'text-decoration', 'visibility', 'display',
    'paint-order', 'stop-color', 'stop-opacity',
    'vector-effect', 'clip-rule', 'clip-path', 'mask', 'filter',
    'marker-start', 'marker-mid', 'marker-end', 'transform', 'transform-origin',
    'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height',
];

/** Resolve CSS inside an isolated light document: application styles must never leak into Word. */
export async function standaloneWordSvg(source: string, load: (url: string) => Promise<Blob>): Promise<string> {
    const prepared = withIntrinsicSize(await prepareSvg(source, { strict: true, resolveResource: load }));
    const parsed = new DOMParser().parseFromString(prepared, 'image/svg+xml');
    if (parsed.querySelector('script, iframe, object, embed')) throw new Error('Unsupported active SVG content');
    for (const dimension of ['width', 'height']) {
        const value = parsed.documentElement.getAttribute(dimension);
        if (!value || value.includes('%')) throw new Error('SVG has no intrinsic dimensions or usable viewBox');
    }
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:1000px;height:1000px;left:-10000px;visibility:hidden;pointer-events:none';
    frame.setAttribute('aria-hidden', 'true');
    document.body.appendChild(frame);
    try {
        const doc = frame.contentDocument!;
        doc.body.style.cssText = 'margin:0;color:#1a1a1a;background:white';
        // These are paper defaults, not values read from Dashboard's active theme.
        doc.documentElement.style.cssText = '--bg:white;--text:#1a1a1a;--fg:#1a1a1a;--border:#999;--muted:#666;--link:#1a1a1a;--accent-bg:#f0f0f0;--input-bg:#f5f5f5';
        const svg = doc.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
        doc.body.appendChild(svg);
        const elements = [svg, ...Array.from(svg.querySelectorAll<SVGElement>('*'))];
        // Read all styles before changing any: inheritance and selectors still see the authored tree.
        const styles = elements.map(element => {
            const computed = frame.contentWindow!.getComputedStyle(element);
            return SVG_STYLE_PROPERTIES.map(property => [property, computed.getPropertyValue(property)
                // CSSOM expands local paint/marker references against about:blank in the iframe.
                .replace(/url\(["']?about:blank(#[^"')]+)["']?\)/g, 'url($1)')]);
        });
        elements.forEach((element, index) => {
            if (element.localName === 'style') return;
            for (const [property, value] of styles[index]) if (value) element.style.setProperty(property, value);
        });
        svg.querySelectorAll('style').forEach(style => style.remove());
        // No dimensions from the editor pane; take the SVG's own layout, including physical units.
        const width = svg.width.baseVal.value;
        const height = svg.height.baseVal.value;
        fitWordImage(width, height); // Reject invalid/zero sizes before packaging or rasterizing.
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        svg.style.removeProperty('max-width');
        svg.style.removeProperty('width');
        svg.style.removeProperty('height');
        const result = new XMLSerializer().serializeToString(svg);
        if (/var\(/.test(result)) throw new Error('SVG still contains unresolved CSS variables');
        // External <use>, filters, etc. cannot be silently retained in a portable file.
        for (const element of elements) {
            if (element.localName === 'a') continue; // Hyperlinks do not affect the picture's rendering.
            for (const attr of Array.from(element.attributes)) {
                if (attr.localName === 'href' && !/^(#|data:)/.test(attr.value)) {
                    throw new Error(`SVG contains an external reference: ${attr.value}`);
                }
            }
        }
        return result;
    } finally {
        frame.remove();
    }
}

async function decodeImage(blob: Blob): Promise<HTMLImageElement> {
    const url = URL.createObjectURL(blob);
    try {
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error('Image could not be decoded'));
            image.src = url;
        });
        return image;
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function pngOf(image: HTMLImageElement, width: number, height: number): Promise<Uint8Array> {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width * 2));
    canvas.height = Math.max(1, Math.ceil(height * 2));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable for image compatibility preview');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        result => result ? resolve(result) : reject(new Error('Image preview could not be generated')), 'image/png',
    ));
    return new Uint8Array(await blob.arrayBuffer());
}

/** SVG remains referenced via asvg:svgBlip; PNG is the ordinary DrawingML compatibility image. */
export async function wordImage(
    blob: Blob, alt: string, load: (url: string) => Promise<Blob>, maxWidth = WORD_CONTENT_WIDTH,
): Promise<ImageRun> {
    const svg = blob.type.includes('svg') ? await standaloneWordSvg(await blob.text(), load) : null;
    const image = await decodeImage(svg ? new Blob([svg], { type: 'image/svg+xml' }) : blob);
    const root = svg ? new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement : null;
    // SVG intrinsic sizes may be fractional; Image.naturalWidth rounds them and changes the ratio.
    const transformation = fitWordImage(
        root ? Number(root.getAttribute('width')) : image.naturalWidth,
        root ? Number(root.getAttribute('height')) : image.naturalHeight, maxWidth,
    );
    const altText = { title: alt, description: alt, name: alt };
    if (svg) {
        return new ImageRun({
            type: 'svg', data: new TextEncoder().encode(svg), transformation, altText,
            fallback: { type: 'png', data: await pngOf(image, transformation.width, transformation.height) },
        });
    }
    const type = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp' } as const)[blob.type as 'image/png'];
    // WebP/AVIF are browser images but not portable Word media; convert them using the browser.
    return new ImageRun({
        type: type || 'png', data: type ? new Uint8Array(await blob.arrayBuffer()) : await pngOf(image, transformation.width, transformation.height),
        transformation, altText,
    });
}
