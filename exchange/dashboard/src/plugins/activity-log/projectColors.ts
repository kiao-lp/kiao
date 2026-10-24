/**
 * Colours the proportion bar of a daily activity log paints its projects with.
 *
 * A project's colour is a *slot name*, not a hex: the light and dark themes need
 * genuinely different steps of the same hue, so only the name survives in
 * `config.json` and the CSS in `ActivityLogBar.css` resolves it per theme. A raw
 * `#rrggbb` is accepted in the same field as a manual override and used verbatim
 * in both themes.
 *
 * The eight slots are a categorical palette validated against the folder table's
 * own surfaces (`--table-even`, light and dark): worst adjacent colour-blind
 * separation ΔE 9.1 light / 8.4 dark, worst normal-vision ΔE 19.6 / 19.3. Four
 * light-mode slots sit below 3:1 against the row, which is legal only with a
 * relief channel — the labels written inside wide segments are it.
 */

import { inkFor, isHexColor } from '@cms-kit/color';

/**
 * A hex a project may be given in place of a slot, and the ink a label on it wears: they are
 * `@cms-kit/color`'s, one rule for every colour the user picks anywhere in this CMS.
 */
export { inkFor, isHexColor };

export const PROJECT_COLOR_SLOTS = [
    'blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red',
] as const;

export type ProjectColorSlot = typeof PROJECT_COLOR_SLOTS[number];

/**
 * The neutral slot. It carries no identity — it means "no colour left", and is
 * what a ninth project and any project missing from the configuration get.
 */
export const OTHER_COLOR_SLOT = 'other';

/** A project's stored colour: a palette slot name, `other`, or a hex override. */
export type ProjectColor = string;

/** Colours per project, as stored in `config.json`. */
export type ProjectColors = Record<string, ProjectColor>;

const SLOTS: readonly string[] = PROJECT_COLOR_SLOTS;

export const isColorSlot = (value: unknown): value is ProjectColorSlot =>
    typeof value === 'string' && SLOTS.includes(value);

/** Whether a value may be stored as a project colour. */
export const isProjectColor = (value: unknown): value is ProjectColor =>
    isColorSlot(value) || value === OTHER_COLOR_SLOT || isHexColor(value);

/**
 * Gives every project without a colour the first palette slot no other project
 * holds, in palette order, and leaves the colours already chosen untouched — a
 * project keeps its colour for good, so adding one never repaints the others.
 * Projects past the eighth share the neutral slot.
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

/** How a segment of the bar is painted: its fill, and the ink a label on it wears. */
export type ProjectPaint = { fill: string; ink: string };

const OTHER_PAINT: ProjectPaint = {
    fill: 'var(--activity-color-other)',
    ink: 'var(--activity-ink-other)',
};

/** Resolves a project's stored colour into the fill and ink the bar renders with. */
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
