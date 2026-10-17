import { ClassMember } from './archdia-model';
import { BOX_FONT_SIZE, BOX_HEIGHT, BOX_LINE_STEP, BOX_MIN_WIDTH, BOX_PAD_X } from '@cms-kit/diagram-shared';

export const DEFAULT_NODE_WIDTH = 180;
export const DEFAULT_NODE_HEIGHT = BOX_HEIGHT;
const CHAR_WIDTH_ESTIMATE = 8;

// Class member rendering constants — exported for renderer use.
export const CLASS_HEADER_HEIGHT = 36;
export const CLASS_MEMBER_LINE_HEIGHT = 18;
export const CLASS_SECTION_PAD = 8;
export const CLASS_MIN_SECTION_HEIGHT = 4;

const COMPONENT_LABEL_FONT_SIZE = BOX_FONT_SIZE;
const COMPONENT_STEREOTYPE_FONT_SIZE = 14;
const CLASS_MEMBER_FONT_SIZE = 12;

const charWidths: Record<string, number> = {
    // Uppercase
    'A': 0.667, 'B': 0.667, 'C': 0.722, 'D': 0.722, 'E': 0.667, 'F': 0.611, 'G': 0.778,
    'H': 0.722, 'I': 0.278, 'J': 0.5, 'K': 0.667, 'L': 0.556, 'M': 0.833, 'N': 0.722,
    'O': 0.778, 'P': 0.667, 'Q': 0.778, 'R': 0.722, 'S': 0.667, 'T': 0.611, 'U': 0.722,
    'V': 0.667, 'W': 0.944, 'X': 0.667, 'Y': 0.667, 'Z': 0.611,
    // Lowercase
    'a': 0.556, 'b': 0.556, 'c': 0.5, 'd': 0.556, 'e': 0.556, 'f': 0.278, 'g': 0.556,
    'h': 0.556, 'i': 0.222, 'j': 0.222, 'k': 0.5, 'l': 0.222, 'm': 0.833, 'n': 0.556,
    'o': 0.556, 'p': 0.556, 'q': 0.556, 'r': 0.333, 's': 0.5, 't': 0.278, 'u': 0.556,
    'v': 0.5, 'w': 0.722, 'x': 0.5, 'y': 0.5, 'z': 0.5,
    // Numbers
    '0': 0.556, '1': 0.556, '2': 0.556, '3': 0.556, '4': 0.556, '5': 0.556, '6': 0.556,
    '7': 0.556, '8': 0.556, '9': 0.556,
    // Punctuation and symbols
    ' ': 0.278, '.': 0.278, ',': 0.278, ':': 0.278, ';': 0.278, '!': 0.278, '?': 0.556,
    "'": 0.19, '"': 0.333, '(': 0.333, ')': 0.333, '[': 0.333, ']': 0.333, '{': 0.333, '}': 0.333,
    '-': 0.333, '_': 0.5, '+': 0.556, '=': 0.556, '*': 0.389, '/': 0.278, '\\': 0.278,
    '|': 0.278, '@': 1.0, '#': 0.556, '$': 0.556, '%': 0.889, '^': 0.469, '&': 0.667,
    '<': 0.556, '>': 0.556, '~': 0.556, '`': 0.333,
    // Latin-1 Supplement (common French characters)
    'é': 0.556, 'è': 0.556, 'ê': 0.556, 'ë': 0.556,
    'à': 0.556, 'â': 0.556, 'ä': 0.556,
    'ô': 0.556, 'ö': 0.556,
    'î': 0.222, 'ï': 0.222,
    'û': 0.556, 'ü': 0.556, 'ù': 0.556,
    'ç': 0.5,
    'É': 0.667, 'È': 0.667, 'Ê': 0.667, 'Ë': 0.667,
    'À': 0.667, 'Â': 0.667, 'Ä': 0.667,
    'Ô': 0.778, 'Ö': 0.778,
    'Î': 0.278, 'Ï': 0.278,
    'Û': 0.722, 'Ü': 0.722, 'Ù': 0.722,
    'Ç': 0.722,
};

function estimateTextWidth(text: string, fontSize: number, monospace = false): number {
    let width = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const prop = monospace ? 0.6 : (charWidths[char] ?? 0.5);
        width += prop * fontSize;
    }
    return width;
}

export function estimateNodeWidth(label: string, members?: ClassMember[], stereotype?: string): number {
    // Handle multi-line labels (PlantUML \n)
    const lines = label.replace(/\\n/g, '\n').split('\n');
    const maxLineWithProps = Math.max(...lines.map(l => estimateTextWidth(l, COMPONENT_LABEL_FONT_SIZE)));
    // A drawn stereotype («service») can outspan a short label; hidden ones (structural,
    // MoSCoW) are never passed by the renderer, and only cost layouts some slack.
    const stereoWidth = stereotype ? estimateTextWidth(`«${stereotype}»`, COMPONENT_STEREOTYPE_FONT_SIZE) : 0;
    let w = Math.max(BOX_MIN_WIDTH, Math.max(maxLineWithProps, stereoWidth) + BOX_PAD_X * 2);

    if (members && members.length > 0) {
        // Ensure the box is wide enough for the longest member text
        // Account for visibility marker (~2 chars) and padding
        const maxMemberWidth = Math.max(...members.map(m => {
            const visWidth = m.visibility ? estimateTextWidth('+ ', CLASS_MEMBER_FONT_SIZE, true) : 0;
            return estimateTextWidth(m.text, CLASS_MEMBER_FONT_SIZE, true) + visWidth;
        }));
        w = Math.max(w, maxMemberWidth + 32);
    }

    return w;
}

export function getNodeHeight(type?: string, members?: ClassMember[], label?: string): number {
    if (members && members.length > 0) {
        return getClassNodeHeight(members, type);
    }

    // Further text lines (PlantUML \n) grow the box the way PlantUML grows its own.
    const extraLines = label ? label.replace(/\\n/g, '\n').split('\n').length - 1 : 0;
    const plainHeight = DEFAULT_NODE_HEIGHT + Math.max(0, extraLines) * BOX_LINE_STEP;

    if (!type) return plainHeight;
    const t = type.toLowerCase();

    // Icon-style types need more height for the icon + label below
    const iconTypes = new Set([
        'database', 'actor', 'queue', 'cloud', 'storage',
        'collections', 'folder', 'artifact', 'boundary',
        'control', 'entity'
    ]);

    if (iconTypes.has(t)) {
        return 75; // taller for icon shapes
    }

    return plainHeight;
}

/**
 * Compute the height of a class/interface node based on its members.
 *
 * Layout:
 *   Header (name + stereotype):  CLASS_HEADER_HEIGHT
 *   Properties section:          n * CLASS_MEMBER_LINE_HEIGHT + padding
 *   Methods section:             n * CLASS_MEMBER_LINE_HEIGHT + padding
 */
export function getClassNodeHeight(members: ClassMember[], type?: string): number {
    const properties = members.filter(m => m.kind === 'property');
    const methods = members.filter(m => m.kind === 'method');
    const isEnum = type?.toLowerCase() === 'enum';

    const propsHeight = properties.length > 0
        ? properties.length * CLASS_MEMBER_LINE_HEIGHT + CLASS_SECTION_PAD
        : (isEnum ? 0 : CLASS_MIN_SECTION_HEIGHT);

    const methodsHeight = (methods.length > 0)
        ? methods.length * CLASS_MEMBER_LINE_HEIGHT + CLASS_SECTION_PAD
        : (isEnum ? 0 : CLASS_MIN_SECTION_HEIGHT);

    return CLASS_HEADER_HEIGHT + propsHeight + methodsHeight;
}

