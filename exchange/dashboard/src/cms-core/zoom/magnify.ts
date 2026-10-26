// Fixed positioning and a placeholder keep the page still. CSS zoom redraws content at the
// magnified size; pinning its width preserves line breaks.
// Targets must have no transformed or filtered ancestors: these contain fixed descendants,
// allowing intervening scrollers to clip them.

import { placeInViewport, zoomBounds, VIEWPORT_MARGIN, type Box } from './zoomPlacement';
import { resizeHandles } from './resizeHandles';

/** Floating marker whose value is the magnification factor. */
export const FLOATING_ATTR = 'data-cms-zoom-floating';

/** Marks the placeholder holding the floating element's space. */
export const PLACEHOLDER_ATTR = 'data-cms-zoom-placeholder';

/** Above app chrome, below Ant Design popups (1000+) so they remain reachable. */
const FLOATING_Z_INDEX = 900;

/** Large enough to avoid measurement rounding, small enough to stay on screen. */
const PROBE_OFFSET = 100;

/** Exclude the slider bar so magnification cannot hide its own control. */
const CONTROL_BAR_SELECTOR = '.cms-top-banner';

export interface Magnified {
    reposition: () => void;
    setFactor: (factor: number) => void;
    release: () => void;
}

const isTransparent = (color: string) => !color || color === 'transparent' || /,\s*0\s*\)$/.test(color);

/** Inherit the nearest painted background: page colour could erase chat-bubble text contrast. */
const surfaceUnder = (element: HTMLElement, view: Window): string | null => {
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        const color = view.getComputedStyle(node).backgroundColor;
        if (!isTransparent(color)) return color;
    }
    return null;
};

/**
 * Local-to-screen scale, including ancestor zoom (e.g. markdown preview).
 * Needed for placeholder size, layout width and viewport caps; offsetWidth supplies the fallback.
 */
const zoomAround = (element: HTMLElement, onScreen: DOMRect): number => {
    const stated = (element as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom;
    if (stated) return stated;
    return element.offsetWidth ? onScreen.width / element.offsetWidth : 1;
};

const availableArea = (doc: Document): Box => {
    const view = doc.defaultView!;
    const width = view.innerWidth;
    const height = view.innerHeight;
    const bar = doc.querySelector(CONTROL_BAR_SELECTOR);
    // Cap bar exclusion at a third of the viewport to tolerate a broken bar layout.
    const top = bar ? Math.max(0, Math.min(bar.getBoundingClientRect().bottom, height / 3)) : 0;
    return { left: 0, top, width, height: height - top };
};

/** Responsive children keep their layout width when the scrollable parent reaches a viewport cap. */
const pinContentWidths = (element: HTMLElement, view: Window) => {
    const saved = new Map<HTMLElement | SVGElement, { name: string; value: string; priority: string }[]>();
    for (const child of element.children) {
        if (!('style' in child)) continue;
        const node = child as HTMLElement | SVGElement;
        const computed = view.getComputedStyle(node);
        if (['absolute', 'fixed'].includes(computed.position)
            || ['inline', 'none', 'contents'].includes(computed.display)
            || !(parseFloat(computed.width) > 0)) continue;
        const properties = ['width', 'min-width', 'max-width', 'flex-shrink'];
        saved.set(node, properties.map(name => ({
            name, value: node.style.getPropertyValue(name), priority: node.style.getPropertyPriority(name),
        })));
        node.style.setProperty('width', computed.width);
        node.style.setProperty('min-width', computed.width);
        node.style.setProperty('max-width', 'none');
        node.style.setProperty('flex-shrink', '0');
    }
    return () => {
        for (const [node, properties] of saved) {
            for (const { name, value, priority } of properties) {
                if (value) node.style.setProperty(name, value, priority);
                else node.style.removeProperty(name);
            }
        }
    };
};

/** Styles the original element so streaming content and handlers survive until release. */
export const magnify = (element: HTMLElement, factor: number, margin: number = VIEWPORT_MARGIN): Magnified => {
    const doc = element.ownerDocument;
    const view = doc.defaultView!;
    const style = element.style;
    const savedCssText = style.cssText;
    const computed = view.getComputedStyle(element);

    // Measure before styling changes the box or its ambient zoom.
    const base = element.getBoundingClientRect();
    const ambient = zoomAround(element, base);
    // Magnified local-to-screen scale.
    let scale = factor * ambient;
    // Dimensions in the original flow's units.
    const own = { width: base.width / ambient, height: base.height / ambient };
    const restoreContent = pinContentWidths(element, view);
    let resized: Box | null = null;

    // Preserve margins and pin the flex/grid slot size so surrounding content stays still.
    const margins = [computed.marginTop, computed.marginRight, computed.marginBottom, computed.marginLeft]
        .map(side => side || '0')
        .join(' ');
    const placeholder = doc.createElement('div');
    placeholder.setAttribute(PLACEHOLDER_ATTR, '');
    placeholder.style.cssText = [
        'box-sizing:border-box',
        'flex:0 0 auto',
        'pointer-events:none',
        'visibility:hidden',
        `width:${own.width}px`,
        `height:${own.height}px`,
        `margin:${margins}`,
    ].join(';');
    element.parentNode?.insertBefore(placeholder, element);

    element.setAttribute(FLOATING_ATTR, String(factor));
    style.setProperty('position', 'fixed');
    style.setProperty('z-index', String(FLOATING_Z_INDEX));
    style.setProperty('margin', '0');
    style.setProperty('box-sizing', 'border-box');
    // Pin border-box width to preserve layout under zoom.
    style.setProperty('width', `${own.width}px`);
    style.setProperty('min-width', '0');
    style.setProperty('overflow', 'auto');
    style.setProperty('zoom', String(factor));

    if (isTransparent(computed.backgroundColor)) {
        style.setProperty('background-color', surfaceUnder(element, view) ?? 'var(--bg, #fff)');
    }

    // Browser zoom handling of left/top varies. Probe the screen origin and per-unit movement
    // once while these styles hold; reuse the transform during repositioning.
    let atZero: DOMRect;
    let unitX: number;
    let unitY: number;
    const measureOffsets = () => {
        style.setProperty('left', '0px');
        style.setProperty('top', '0px');
        atZero = element.getBoundingClientRect();
        style.setProperty('left', `${PROBE_OFFSET}px`);
        style.setProperty('top', `${PROBE_OFFSET}px`);
        const atProbe = element.getBoundingClientRect();
        unitX = (atProbe.left - atZero.left) / PROBE_OFFSET || 1;
        unitY = (atProbe.top - atZero.top) / PROBE_OFFSET || 1;
    };
    measureOffsets();

    const reposition = () => {
        if (!element.isConnected) return;
        const area = availableArea(doc);
        const { maxWidth, maxHeight } = zoomBounds(area, margin);
        // Convert viewport caps to local units, including ancestor zoom.
        const ceiling = maxHeight / scale;
        style.setProperty('max-width', `${maxWidth / scale}px`);
        style.setProperty('max-height', `${ceiling}px`);
        style.setProperty('width', `${resized ? resized.width / scale : own.width}px`);
        if (resized) style.setProperty('height', `${resized.height / scale}px`);
        // Preserve stretched height, allowing rounding slack. Cap min-height too: CSS gives it
        // precedence over max-height, letting content overflow the viewport instead of scrolling inside.
        style.setProperty('min-height', `${resized ? 0 : Math.min(own.height, ceiling)}px`);
        // The placeholder follows the original flow as its panel scrolls.
        const anchor = resized ?? placeholder.getBoundingClientRect();
        // Measure because viewport caps may have shrunk the element.
        const size = element.getBoundingClientRect();
        const at = placeInViewport(anchor, size, area, margin);
        style.setProperty('left', `${(at.left - atZero.left) / unitX}px`);
        style.setProperty('top', `${(at.top - atZero.top) / unitY}px`);
        handles.place({ ...at, width: size.width, height: size.height });
    };

    const handles = resizeHandles(doc, () => availableArea(doc), box => {
        resized = box;
        reposition();
    }, margin);
    reposition();

    return {
        reposition,
        setFactor: next => {
            if (next === factor) return;
            factor = next;
            scale = factor * ambient;
            element.setAttribute(FLOATING_ATTR, String(factor));
            style.setProperty('zoom', String(factor));
            measureOffsets();
            reposition();
        },
        release: () => {
            handles.release();
            restoreContent();
            style.cssText = savedCssText;
            element.removeAttribute(FLOATING_ATTR);
            placeholder.remove();
        },
    };
};
