/**
 * Node sizing utilities for graph diagrams.
 */

import { BOX_FONT_SIZE, BOX_HEIGHT, BOX_MIN_WIDTH, BOX_PAD_X, EDGE_LABEL_FONT_SIZE } from '@cms-kit/diagram-shared';

export const DEFAULT_NODE_WIDTH = 160;
export const DEFAULT_NODE_HEIGHT = BOX_HEIGHT;
export const NODE_WITH_VALUE_HEIGHT = BOX_HEIGHT + 20;
const TITLE_FONT_SIZE = BOX_FONT_SIZE;
const VALUE_FONT_SIZE = EDGE_LABEL_FONT_SIZE;

const charWidths: Record<string, number> = {
    'A': 0.667, 'B': 0.667, 'C': 0.722, 'D': 0.722, 'E': 0.667, 'F': 0.611, 'G': 0.778,
    'H': 0.722, 'I': 0.278, 'J': 0.5, 'K': 0.667, 'L': 0.556, 'M': 0.833, 'N': 0.722,
    'O': 0.778, 'P': 0.667, 'Q': 0.778, 'R': 0.722, 'S': 0.667, 'T': 0.611, 'U': 0.722,
    'V': 0.667, 'W': 0.944, 'X': 0.667, 'Y': 0.667, 'Z': 0.611,
    'a': 0.556, 'b': 0.556, 'c': 0.5, 'd': 0.556, 'e': 0.556, 'f': 0.278, 'g': 0.556,
    'h': 0.556, 'i': 0.222, 'j': 0.222, 'k': 0.5, 'l': 0.222, 'm': 0.833, 'n': 0.556,
    'o': 0.556, 'p': 0.556, 'q': 0.556, 'r': 0.333, 's': 0.5, 't': 0.278, 'u': 0.556,
    'v': 0.5, 'w': 0.722, 'x': 0.5, 'y': 0.5, 'z': 0.5,
    '0': 0.556, '1': 0.556, '2': 0.556, '3': 0.556, '4': 0.556, '5': 0.556, '6': 0.556,
    '7': 0.556, '8': 0.556, '9': 0.556,
    ' ': 0.278, '.': 0.278, ',': 0.278, ':': 0.278, ';': 0.278, '!': 0.278, '?': 0.556,
    '-': 0.333, '_': 0.5, '(': 0.333, ')': 0.333,
    'é': 0.556, 'è': 0.556, 'ê': 0.556, 'à': 0.556, 'â': 0.556, 'ô': 0.556,
    'î': 0.222, 'û': 0.556, 'ü': 0.556, 'ç': 0.5,
};

function estimateTextWidth(text: string, fontSize: number): number {
    let width = 0;
    for (let i = 0; i < text.length; i++) {
        width += (charWidths[text[i]] ?? 0.5) * fontSize;
    }
    return width;
}

/** Estimate node width based on title and values map. */
export function estimateNodeWidth(title: string, values?: Record<string, number>): number {
    const titleW = estimateTextWidth(title, TITLE_FONT_SIZE);
    let valuesW = 0;
    if (values) {
        const entries = Object.entries(values);
        for (const [, v] of entries) {
            valuesW += estimateTextWidth(String(v), VALUE_FONT_SIZE);
        }
        if (entries.length > 1) valuesW += (entries.length - 1) * estimateTextWidth(' | ', VALUE_FONT_SIZE);
    }
    return Math.max(BOX_MIN_WIDTH, Math.max(titleW, valuesW) + BOX_PAD_X * 2);
}

/** Get node height based on whether it has values. */
export function getNodeHeight(values?: Record<string, number>): number {
    return values && Object.keys(values).length > 0 ? NODE_WITH_VALUE_HEIGHT : DEFAULT_NODE_HEIGHT;
}
