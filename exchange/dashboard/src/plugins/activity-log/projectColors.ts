/**
 * Stored colors are slot names, not hex, so CSS resolves them per theme.
 * A hex value is a manual override, used verbatim in both themes.
 * Palette validation (worst adjacent ΔE): color-blind 9.1 light / 8.4 dark; normal 19.6 / 19.3.
 * Four light slots are below 3:1 against rows; segment labels provide contrast.
 */

import { inkFor, isHexColor } from '@kiao-dashboard-kit/color';

export { inkFor, isHexColor };

export const PROJECT_COLOR_SLOTS = [
    'blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red',
] as const;

export type ProjectColorSlot = typeof PROJECT_COLOR_SLOTS[number];

/** For projects past the palette and projects missing from the config. */
export const OTHER_COLOR_SLOT = 'other';

export type ProjectColor = string;

export type ProjectColors = Record<string, ProjectColor>;

const SLOTS: readonly string[] = PROJECT_COLOR_SLOTS;

export const isColorSlot = (value: unknown): value is ProjectColorSlot =>
    typeof value === 'string' && SLOTS.includes(value);

export const isProjectColor = (value: unknown): value is ProjectColor =>
    isColorSlot(value) || value === OTHER_COLOR_SLOT || isHexColor(value);

/**
 * Assigns the first free slot to uncolored projects.
 * Existing colors never change; projects past the eighth use `other`.
 */
export const assignProjectColors = (existing: ProjectColors, projects: string[]): ProjectColors => {
    const assigned: ProjectColors = { ...existing };
    const taken = new Set(Object.values(assigned));
    for (const project of projects) {
        if (assigned[project]) continue;
        assigned[project] = SLOTS.find(slot => !taken.has(slot)) ?? OTHER_COLOR_SLOT;
        taken.add(assigned[project]);
    }
    return assigned;
};

export type ProjectPaint = { fill: string; ink: string };

const OTHER_PAINT: ProjectPaint = {
    fill: 'var(--activity-color-other)',
    ink: 'var(--activity-ink-other)',
};

export const paintFor = (project: string, colors: ProjectColors): ProjectPaint => {
    const color = colors[project];
    if (isColorSlot(color)) {
        return { fill: `var(--activity-color-${color})`, ink: `var(--activity-ink-${color})` };
    }
    if (isHexColor(color)) {
        return { fill: color, ink: inkFor(color) };
    }
    return OTHER_PAINT;
};
