import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatLocalDateTime, localizeNoticeDateTimes } from './index';

const NativeDateTimeFormat = Intl.DateTimeFormat;

beforeEach(() => {
    vi.stubGlobal('Intl', Object.create(Intl, {
        DateTimeFormat: { value: class extends NativeDateTimeFormat {
            constructor(_locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
                super('fr-FR', { ...options, timeZone: 'Europe/Paris' });
            }
        } },
    }));
});

afterEach(() => vi.unstubAllGlobals());

describe('local datetimes', () => {
    it('includes the weekday, date and local time even for today', () => {
        expect(formatLocalDateTime(Date.parse('2026-10-23T09:59:32Z'))).toBe('ven. 23 oct., 11:59');
    });

    it('uses the offset at the reset instant, including a change of day or daylight saving', () => {
        expect(formatLocalDateTime(Date.parse('2026-10-23T23:15:00Z'))).toBe('sam. 24 oct., 01:15');
        expect(formatLocalDateTime(Date.parse('2026-10-25T09:59:32Z'))).toBe('dim. 25 oct., 10:59');
    });

    it.each([
        'Your usage window resets at 2026-10-23T09:59:32Z',
        'Your usage window resets at 2026-10-23T11:59:32+02:00',
        'Your usage window resets at 2026-10-23T09:59:32.123Z',
        `Claude AI usage limit reached|${Date.parse('2026-10-23T09:59:32Z') / 1000}`,
        `Claude AI usage limit reached|${Date.parse('2026-10-23T09:59:32Z')}`,
    ])('localizes provider notice %s', notice => {
        const localized = localizeNoticeDateTimes(notice);
        expect(localized).toContain('resets at ven. 23 oct., 11:59');
        expect(localized).not.toMatch(/2026-|\|\d/);
    });

    it('localizes each instant in a run notice and preserves invalid timestamps', () => {
        expect(localizeNoticeDateTimes('Resets at 2026-10-23T09:59:32Z; resumes at 2026-10-23T10:00:32Z.'))
            .toBe('Resets at ven. 23 oct., 11:59; resumes at ven. 23 oct., 12:00.');
        expect(localizeNoticeDateTimes('resets at 2026-13-23T09:59:32Z'))
            .toBe('resets at 2026-13-23T09:59:32Z');
    });
});
