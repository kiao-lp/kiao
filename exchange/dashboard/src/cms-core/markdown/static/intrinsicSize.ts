/** Exported SVG images need intrinsic pixel dimensions; percentage sizes need a containing box. */

/** Intrinsic dimensions must be positive, unitless pixel values. */
const isIntrinsic = (value: string | null): boolean =>
    !!value && !/[%a-z]/i.test(value) && parseFloat(value) > 0;

/**
 * Preserve usable dimensions; otherwise derive both from a positive viewBox size.
 * Leave malformed SVG or SVG without a usable viewBox unchanged; never invent dimensions.
 */
export function withIntrinsicSize(svg: string): string {
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    if (root.nodeName === 'parsererror' || root.querySelector('parsererror')) return svg;
    if (isIntrinsic(root.getAttribute('width')) && isIntrinsic(root.getAttribute('height'))) return svg;

    const viewBox = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(parseFloat);
    if (viewBox.length !== 4 || !(viewBox[2] > 0) || !(viewBox[3] > 0)) return svg;

    root.setAttribute('width', String(viewBox[2]));
    root.setAttribute('height', String(viewBox[3]));
    return new XMLSerializer().serializeToString(root);
}
