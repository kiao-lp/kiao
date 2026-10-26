/** Choose label ink from the user-picked fill, independently of the theme. */

export const INK_DARK = '#111827';
export const INK_LIGHT = '#ffffff';

/** Accepts `#rgb` or `#rrggbb`, case-insensitively. */
export const isHexColor = (value: unknown): value is string =>
    typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);

const channelLuminance = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = (hex: string): number => {
    const digits = hex.length === 4
        ? hex.slice(1).split('').map(digit => digit + digit).join('')
        : hex.slice(1);
    const value = parseInt(digits, 16);
    return 0.2126 * channelLuminance((value >> 16) & 255)
        + 0.7152 * channelLuminance((value >> 8) & 255)
        + 0.0722 * channelLuminance(value & 255);
};

/** Equal-contrast luminance for white and INK_DARK; dark wins above it. */
const INK_CROSSOVER_LUMINANCE = 0.1993;

export const inkFor = (hex: string): string =>
    relativeLuminance(hex) > INK_CROSSOVER_LUMINANCE ? INK_DARK : INK_LIGHT;
