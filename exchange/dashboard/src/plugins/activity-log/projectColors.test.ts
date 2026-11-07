import { describe, expect, it } from 'vitest';
import { OTHER_COLOR_SLOT, PROJECT_COLOR_SLOTS, assignProjectColors, inkFor, isProjectColor, paintFor } from './projectColors';

describe('activity log project colours', () => {
    it('gives every project the first free palette slot, in palette order', () => {
        expect(assignProjectColors({}, ['Blog', 'Docs', 'Kiao']))
            .toEqual({ Blog: 'blue', Docs: 'orange', Kiao: 'aqua' });
    });

    it('keeps the colours already chosen and skips the slots they hold', () => {
        expect(assignProjectColors({ Kiao: 'orange' }, ['Blog', 'Docs', 'Kiao']))
            .toEqual({ Kiao: 'orange', Blog: 'blue', Docs: 'aqua' });
    });

    it('never repaints a project when another is added before it', () => {
        const first = assignProjectColors({}, ['Blog', 'Kiao']);
        // "Aardvark" sorts ahead of both, and still takes what is left over.
        expect(assignProjectColors(first, ['Aardvark', 'Blog', 'Kiao']))
            .toEqual({ Blog: 'blue', Kiao: 'orange', Aardvark: 'aqua' });
    });

    it('leaves a hex override in place and works around the slots it does not hold', () => {
        expect(assignProjectColors({ Kiao: '#123456' }, ['Blog', 'Kiao']))
            .toEqual({ Kiao: '#123456', Blog: 'blue' });
    });

    it('hands the neutral slot to every project past the eighth', () => {
        const projects = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'];
        const colors = assignProjectColors({}, projects);
        expect(projects.slice(0, 8).map(project => colors[project])).toEqual([...PROJECT_COLOR_SLOTS]);
        expect(colors.P9).toBe(OTHER_COLOR_SLOT);
        expect(colors.P10).toBe(OTHER_COLOR_SLOT);
    });

    it('accepts palette slots, the neutral slot and hex overrides as stored colours', () => {
        expect(isProjectColor('violet')).toBe(true);
        expect(isProjectColor(OTHER_COLOR_SLOT)).toBe(true);
        expect(isProjectColor('#A1b2C3')).toBe(true);
        expect(isProjectColor('#abc')).toBe(true);
        expect(isProjectColor('turquoise')).toBe(false);
        expect(isProjectColor('#12345')).toBe(false);
        expect(isProjectColor(7)).toBe(false);
    });

    it('paints a slot through the theme variables and a hex override as it stands', () => {
        expect(paintFor('Kiao', { Kiao: 'aqua' }))
            .toEqual({ fill: 'var(--activity-color-aqua)', ink: 'var(--activity-ink-aqua)' });
        expect(paintFor('Kiao', { Kiao: '#1a2b3c' })).toEqual({ fill: '#1a2b3c', ink: '#ffffff' });
    });

    it('falls back to the neutral paint for a project the configuration does not know', () => {
        expect(paintFor('Unknown', {}))
            .toEqual({ fill: 'var(--activity-color-other)', ink: 'var(--activity-ink-other)' });
    });

    it('writes a label on a fill in whichever ink contrasts better', () => {
        expect(inkFor('#eda100')).toBe('#111827');
        expect(inkFor('#4a3aa7')).toBe('#ffffff');
        expect(inkFor('#fff')).toBe('#111827');
        expect(inkFor('#000')).toBe('#ffffff');
    });
});
