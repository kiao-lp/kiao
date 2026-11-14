export const formatLocalDateTime = (at: number): string => new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
}).format(new Date(at));

/** Localizes only the displayed text; instants stay absolute. */
export const localizeNoticeDateTimes = (text: string): string => text
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/g, value => {
        const at = Date.parse(value);
        return Number.isFinite(at) ? formatLocalDateTime(at) : value;
    })
    .replace(/(Claude(?: AI)? usage limit reached)\|\s*(\d{9,14})\b/gi, (_, label: string, value: string) => {
        const epoch = Number(value);
        return `${label} · resets at ${formatLocalDateTime(epoch > 1e11 ? epoch : epoch * 1000)}`;
    });
