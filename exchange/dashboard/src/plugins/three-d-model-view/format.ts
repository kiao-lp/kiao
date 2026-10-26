/**
 * The report's numbers, in the words it shows them in.
 *
 * Split out from the panel that draws them because choosing a unit is a decision, not a layout: a
 * model 8 mm across and one 8 km across are both wrong in ways the reader can only see if the
 * number is written the way they would say it out loud. Being arithmetic, it is also the part of
 * the panel that can be checked without rendering anything.
 */

const KILO = 1024;
const MEGA = KILO * KILO;
const GIGA = MEGA * KILO;

/** A weight, at the precision a reader can actually use: no one compares models to the byte. */
export const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < KILO) return `${Math.round(bytes)} B`;
    if (bytes < MEGA) return `${Math.round(bytes / KILO)} kB`;
    if (bytes < GIGA) return `${(bytes / MEGA).toFixed(1)} MB`;
    return `${(bytes / GIGA).toFixed(2)} GB`;
};

/** The thin space digits are grouped by — narrow, and unbreakable, so a count never wraps in half. */
const GROUP_SEPARATOR = ' ';

/**
 * A count, grouped from four figures up.
 *
 * Grouped with a space rather than a comma or a point, because this CMS is read in several
 * languages and those two mean opposite things in some of them.
 */
export const formatCount = (value: number): string => {
    if (!Number.isFinite(value)) return '—';
    const rounded = Math.round(value);
    if (Math.abs(rounded) < 10000) return String(rounded);
    return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
};

/**
 * A length in glTF's units, which the specification fixes as metres.
 *
 * The unit is chosen from the size so that scale is legible at a glance: a model exported from a
 * package that works in millimetres reads as `1.8 mm`, and one that had a unit conversion applied
 * twice reads as `1.8 km`. Both are ordinary mistakes, and both are invisible when everything is
 * printed in metres.
 */
export const formatLength = (metres: number): string => {
    if (!Number.isFinite(metres)) return '—';
    const size = Math.abs(metres);
    if (size < 0.01) return `${(metres * 1000).toFixed(1)} mm`;
    if (size < 1) return `${(metres * 100).toFixed(1)} cm`;
    if (size < 1000) return `${metres.toFixed(2)} m`;
    return `${(metres / 1000).toFixed(2)} km`;
};

/** The three sides of the model's box, in one line. */
export const formatExtent = (size: readonly number[]): string =>
    size.map(formatLength).join(' × ');

/** A clip's length. Minutes appear only once there are any, which for an animation is rare. */
export const formatDuration = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    if (seconds < 60) return `${Number(seconds.toFixed(2))} s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes} min ${String(Math.round(seconds - minutes * 60)).padStart(2, '0')} s`;
};

/** Texture memory is paid in pixels, and pixels are counted in millions. */
export const formatPixels = (pixels: number): string => {
    if (!Number.isFinite(pixels) || pixels <= 0) return '—';
    if (pixels < MEGA) return `${formatCount(Math.round(pixels / 1000))} kpx`;
    return `${(pixels / 1e6).toFixed(1)} Mpx`;
};

/** A share of the whole, as a whole percent — with a floor, so a visible line is never "0%". */
export const formatShare = (part: number, whole: number): string => {
    if (!(whole > 0) || part <= 0) return '0%';
    const percent = (part / whole) * 100;
    return `${percent < 1 ? '<1' : Math.round(percent)}%`;
};
