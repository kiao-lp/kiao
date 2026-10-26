/**
 * Scheduler time is local wall time (YYYY-MM-DDTHH:mm), interpreted by the runner machine.
 * Moving a board across timezones preserves local time, not an instant. Past times run immediately.
 */

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/** Invalid or absent values become empty (unplayable); optional seconds are discarded. */
export const readSchedule = (raw: unknown): string => {
    if (typeof raw !== 'string') return '';
    const said = raw.trim();
    if (!LOCAL_DATETIME.test(said)) return '';
    return said.slice(0, 16);
};

const DURATION = /^(?:[0-9]+(?:\.[0-9]+)?(?:ms|s|m|h))+$/;
const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000 };

/** Same positive duration grammar and upper bound as the runner's time.Duration. */
export const readDuration = (raw: unknown): string => {
    if (typeof raw !== 'string') return '';
    const said = raw.trim();
    if (!DURATION.test(said)) return '';
    const milliseconds = [...said.matchAll(/([0-9]+(?:\.[0-9]+)?)(ms|s|m|h)/g)]
        .reduce((sum, part) => sum + Number(part[1]) * UNITS[part[2]], 0);
    return milliseconds >= 0.000001 && milliseconds <= 9223372036854.775 ? said : '';
};

export const hasSchedule = (at: string, duration?: string): boolean =>
    readDuration(duration) !== '' || readSchedule(at) !== '';

export const scheduleLabel = (at: string, duration?: string): string => {
    const wait = readDuration(duration);
    if (wait) return `Wait ${wait}`;
    const said = readSchedule(at);
    if (!said) return '';
    const when = new Date(said);
    if (Number.isNaN(when.getTime())) return said;
    return when.toLocaleString([], {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
};
