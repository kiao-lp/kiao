import { ProjectColors, isProjectColor } from './projectColors';

export type ActivityLogEntry = {
    date: string;
    project: string;
    durationMinutes: number;
    description?: string;
    /** Optional long, multiline comment attached to this entry. */
    comment?: string;
};

/** A reusable activity preset: project, time spent and description, without a date. */
export type ActivityLogTemplate = {
    project?: string;
    durationMinutes?: number;
    description: string;
};

export type ActivityLogConfig = {
    projects: string[];
    templates: ActivityLogTemplate[];
    /** The colour each project is painted with in the daily proportion bars. */
    projectColors: ProjectColors;
    /** Whose timesheet the CSV export is: written into its first two columns. Absent until set. */
    resourceUnit?: string;
    resourceName?: string;
};

export const ACTIVITY_LOG_EXTENSION = '.actlog.jsonl';

/** Minimal worker client surface needed to read the activity logs of a folder. */
export type ActivityLogWorkerClient = {
    listFiles(path: string): Promise<{ path: string; isDirectory: boolean }[]>;
    getFileText(path: string): Promise<string>;
};

/** Reporting period of the timesheet template this plugin mirrors (Q3 2026). */
export const TIMESHEET_START = '2026-07-01';
export const TIMESHEET_END = '2026-09-30';

const inCurrentFolder = (currentPath: string, filename: string): string => {
    const directory = currentPath.replace(/\/+$/, '');
    return directory ? `${directory}/${filename}` : filename;
};

export const configPathFor = (currentPath: string): string => inCurrentFolder(currentPath, 'config.json');

export const logPathFor = (currentPath: string, date: string): string => inCurrentFolder(currentPath, `${date}${ACTIVITY_LOG_EXTENSION}`);

/** The folder a file lives in, ready to be passed back to `configPathFor`. */
export const folderOf = (path: string): string => path.slice(0, path.lastIndexOf('/') + 1);

/** Returns the activity date encoded in a dated log filename. */
export const dateFromLogPath = (path: string): string | null => {
    const filename = path.split('/').pop() ?? path;
    const match = /^(\d{4}-\d{2}-\d{2})\.actlog\.jsonl$/.exec(filename);
    return match?.[1] ?? null;
};

/** Adds the booked durations from valid JSON Lines in an activity log. */
export const totalBookedMinutes = (text: string): number => text.split('\n').reduce((total, line) => {
    if (!line.trim()) return total;
    try {
        const value: unknown = JSON.parse(line);
        const duration = (value as Partial<ActivityLogEntry>)?.durationMinutes;
        return typeof duration === 'number' && Number.isFinite(duration) && duration > 0
            ? total + duration
            : total;
    } catch {
        return total;
    }
}, 0);

export type ActivityLogSummary = {
    totalMinutes: number;
    projects: {
        project: string;
        minutes: number;
        /** What was done on that project that day, longest first. */
        activities: { description: string; minutes: number }[];
    }[];
};

/**
 * Totals the valid entries of a log and groups them by project, for the file
 * label. Within a project the entries are gathered again by description, so a
 * flow node logged twice in the day reads as one line carrying its whole time. Time
 * booked without a description keeps its own line under the empty string rather
 * than being dropped, so the descriptions always add up to the project.
 */
export const summarizeActivityLog = (text: string): ActivityLogSummary => {
    const minutesByProject = new Map<string, Map<string, number>>();
    for (const entry of parseActivityLogEntries(text)) {
        const byDescription = minutesByProject.get(entry.project) ?? new Map<string, number>();
        const description = entry.description?.trim() ?? '';
        byDescription.set(description, (byDescription.get(description) ?? 0) + entry.durationMinutes);
        minutesByProject.set(entry.project, byDescription);
    }
    const projects = [...minutesByProject.entries()]
        .map(([project, byDescription]) => ({
            project,
            minutes: [...byDescription.values()].reduce((total, minutes) => total + minutes, 0),
            activities: [...byDescription.entries()]
                .map(([description, minutes]) => ({ description, minutes }))
                .sort((a, b) => b.minutes - a.minutes || a.description.localeCompare(b.description)),
        }))
        .sort((a, b) => a.project.localeCompare(b.project));
    return {
        totalMinutes: projects.reduce((total, { minutes }) => total + minutes, 0),
        projects,
    };
};

/** Parses the valid activity entries from a JSON Lines log, ignoring malformed lines. */
export const parseActivityLogEntries = (text: string): ActivityLogEntry[] => text.split('\n').flatMap(line => {
    if (!line.trim()) return [];
    try {
        const value = JSON.parse(line) as Partial<ActivityLogEntry>;
        const date = typeof value.date === 'string' ? value.date : '';
        const project = typeof value.project === 'string' ? value.project.trim() : '';
        const duration = value.durationMinutes;
        if (!date || !project || typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
            return [];
        }
        return [{
            date,
            project,
            durationMinutes: Math.round(duration),
            ...(typeof value.description === 'string' && value.description.trim() ? { description: value.description } : {}),
            ...(typeof value.comment === 'string' && value.comment.trim() ? { comment: value.comment } : {}),
        }];
    } catch {
        return [];
    }
});

/**
 * The configuration of the folder being browsed, shared by everything that needs
 * it. Every row of a folder full of logs asks for the same colours, so the read
 * is made once and the pending promise handed to whoever asks next.
 */
let configCache: { folder: string; config: Promise<ActivityLogConfig> } | null = null;

export const loadFolderConfig = (
    client: Pick<ActivityLogWorkerClient, 'getFileText'>,
    folder: string,
): Promise<ActivityLogConfig> => {
    if (configCache?.folder !== folder) {
        configCache = {
            folder,
            // A missing config is the normal first-run state of a folder.
            config: client.getFileText(configPathFor(folder)).then(readConfig).catch(() => EMPTY_CONFIG),
        };
    }
    return configCache.config;
};

/** Drops the shared configuration, so the next reader sees what was just written. */
export const invalidateFolderConfig = (): void => { configCache = null; };

/** Reads and parses every activity log found directly in the given folder. */
export const collectActivityEntries = async (client: ActivityLogWorkerClient, currentPath: string): Promise<ActivityLogEntry[]> => {
    const files = await client.listFiles(currentPath);
    const entries: ActivityLogEntry[] = [];
    for (const file of files) {
        if (file.isDirectory || !file.path.endsWith(ACTIVITY_LOG_EXTENSION)) continue;
        entries.push(...parseActivityLogEntries(await client.getFileText(file.path)));
    }
    return entries;
};

export const formatBookedDuration = (minutes: number): string => {
    const roundedMinutes = Math.round(minutes);
    return `${Math.floor(roundedMinutes / 60)}h ${roundedMinutes % 60}m`;
};

/** Formats booked time as a compact clock value, e.g. 90 -> "1:30". */
export const formatClockDuration = (minutes: number): string => {
    const roundedMinutes = Math.round(minutes);
    return `${Math.floor(roundedMinutes / 60)}:${String(roundedMinutes % 60).padStart(2, '0')}`;
};

/** Formats booked time the way the timesheet template does, e.g. 90 -> "1h30". */
export const formatTimesheetDuration = (minutes: number): string => {
    const roundedMinutes = Math.round(minutes);
    return `${Math.floor(roundedMinutes / 60)}h${String(roundedMinutes % 60).padStart(2, '0')}`;
};

/** Every calendar date from start to end, inclusive (local dates as YYYY-MM-DD). */
export const timesheetDates = (start: string = TIMESHEET_START, end: string = TIMESHEET_END): string[] => {
    const dates: string[] = [];
    const cursor = new Date(`${start}T00:00:00.000Z`);
    const last = new Date(`${end}T00:00:00.000Z`);
    while (cursor <= last) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
};

export const TIMESHEET_DATES: string[] = timesheetDates();

/** Fixed daily working time used by the timesheet export (7h 45m). */
export const TIMESHEET_DAY_MINUTES = 7 * 60 + 45;

const csvCell = (value: string): string => {
    if (/[",\r\n]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
};

/**
 * Distributes a target number of minutes across projects proportionally to
 * their share of the day's total, rounding to multiples of 5 minutes so the
 * parts still add up to the target.
 */
const TIMESHEET_ROUNDING_MINUTES = 5;

const distributeMinutes = (minutes: number[], target: number): number[] => {
    const total = minutes.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return minutes.map(() => 0);
    const units = target / TIMESHEET_ROUNDING_MINUTES;
    const exactUnits = minutes.map(value => (value / total) * units);
    const roundedUnits = exactUnits.map(value => Math.floor(value));
    let remainder = units - roundedUnits.reduce((sum, value) => sum + value, 0);
    // Hand the leftover units to the largest fractions, keeping each part at
    // the index of the project it belongs to.
    const byLargestFraction = exactUnits
        .map((value, index) => ({ fraction: value - Math.floor(value), index }))
        .sort((a, b) => b.fraction - a.fraction);
    for (const { index } of byLargestFraction) {
        if (remainder <= 0) break;
        roundedUnits[index] += 1;
        remainder -= 1;
    }
    return roundedUnits.map(value => value * TIMESHEET_ROUNDING_MINUTES);
};

/**
 * Builds the completed timesheet CSV: one row per project with the booked
 * duration per day, mirroring the structure of Timesheets_Template.csv.
 */
export const buildTimesheetCsv = (
    entries: ActivityLogEntry[],
    options: { resourceUnit: string; resourceName: string; dates?: string[] },
): string => {
    const dates = options.dates ?? TIMESHEET_DATES;
    const inRange = new Set(dates);
    const minutesByProjectByDate = new Map<string, Map<string, number>>();
    const minutesByDate = new Map<string, number>();
    for (const entry of entries) {
        if (!inRange.has(entry.date)) continue;
        const byDate = minutesByProjectByDate.get(entry.project) ?? new Map<string, number>();
        byDate.set(entry.date, (byDate.get(entry.date) ?? 0) + entry.durationMinutes);
        minutesByProjectByDate.set(entry.project, byDate);
        minutesByDate.set(entry.date, (minutesByDate.get(entry.date) ?? 0) + entry.durationMinutes);
    }

    const projects = [...minutesByProjectByDate.keys()].sort((a, b) => a.localeCompare(b));
    const lines = [['Resource Unit', 'Resource Name', 'Project Name', ...dates]];
    const scaledByDate = new Map<string, Map<string, number>>();
    for (const date of dates) {
        const dayTotal = minutesByDate.get(date) ?? 0;
        if (dayTotal <= 0) continue;
        const scaled = distributeMinutes(
            projects.map(project => minutesByProjectByDate.get(project)?.get(date) ?? 0),
            TIMESHEET_DAY_MINUTES,
        );
        scaledByDate.set(date, new Map(projects.map((project, index) => [project, scaled[index]])));
    }
    for (const project of projects) {
        lines.push([
            options.resourceUnit,
            options.resourceName,
            project,
            ...dates.map(date => {
                const scaled = scaledByDate.get(date)?.get(project) ?? 0;
                return scaled > 0 ? formatTimesheetDuration(scaled) : '';
            }),
        ]);
    }
    return `${lines.map(line => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
};

/** A local calendar date, suitable for an <input type="date"> value. */
export const today = (now = new Date()): string => {
    const offsetDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    return offsetDate.toISOString().slice(0, 10);
};

/** The configuration of a folder that has none yet, or whose file is unreadable. */
export const EMPTY_CONFIG: ActivityLogConfig = { projects: [], templates: [], projectColors: {} };

export const readConfig = (text: string): ActivityLogConfig => {
    try {
        const value: unknown = JSON.parse(text);
        if (!value || typeof value !== 'object') {
            return EMPTY_CONFIG;
        }
        const config = value as Partial<ActivityLogConfig> & { descriptions?: unknown };
        const templates = normalizeTemplates(config.templates);
        // Older configs stored plain description strings; keep them usable as
        // templates without project or time so nothing saved before is lost.
        const legacyDescriptions = normalizeList(config.descriptions)
            .map(description => ({ description }));
        return {
            projects: normalizeList(config.projects),
            templates: templates.length > 0 ? templates : legacyDescriptions,
            projectColors: normalizeProjectColors(config.projectColors),
            ...normalizeIdentity(config.resourceUnit, config.resourceName),
        };
    } catch {
        return EMPTY_CONFIG;
    }
};

/** Keeps the project colours that name a palette slot or a hex override. */
const normalizeProjectColors = (value: unknown): ProjectColors => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const colors: ProjectColors = {};
    for (const [project, color] of Object.entries(value as Record<string, unknown>)) {
        const name = project.trim();
        if (name && isProjectColor(color)) colors[name] = color;
    }
    return colors;
};

/** Keeps unique, trimmed, non-empty strings sorted for the given configuration list. */
/** Keeps the timesheet identity when it names something, and drops it otherwise. */
const normalizeIdentity = (unit: unknown, name: unknown): Pick<ActivityLogConfig, 'resourceUnit' | 'resourceName'> => {
    const out: Pick<ActivityLogConfig, 'resourceUnit' | 'resourceName'> = {};
    if (typeof unit === 'string' && unit.trim()) out.resourceUnit = unit.trim();
    if (typeof name === 'string' && name.trim()) out.resourceName = name.trim();
    return out;
};

const normalizeList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean))].sort((a, b) => a.localeCompare(b));
};

/** Keeps valid reusable templates, deduplicated by description and sorted. */
const normalizeTemplates = (value: unknown): ActivityLogTemplate[] => {
    if (!Array.isArray(value)) return [];
    const templates: ActivityLogTemplate[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const candidate = item as Partial<ActivityLogTemplate>;
        const description = typeof candidate.description === 'string' ? candidate.description.trim() : '';
        if (!description || seen.has(description)) continue;
        seen.add(description);
        templates.push({
            ...(typeof candidate.project === 'string' && candidate.project.trim() ? { project: candidate.project.trim() } : {}),
            ...(typeof candidate.durationMinutes === 'number' && Number.isFinite(candidate.durationMinutes) && candidate.durationMinutes > 0
                ? { durationMinutes: Math.round(candidate.durationMinutes) }
                : {}),
            description,
        });
    }
    return templates.sort((a, b) => a.description.localeCompare(b.description));
};

/** Adds or replaces a reusable template keyed by description, keeping the list sorted. */
export const upsertTemplate = (templates: ActivityLogTemplate[], template: ActivityLogTemplate): ActivityLogTemplate[] =>
    [...templates.filter(item => item.description !== template.description), template]
        .sort((a, b) => a.description.localeCompare(b.description));

/** Supports 90m, 1h 30m, 1.5h, and HH:MM. */
export const durationInMinutes = (value: string): number | null => {
    const input = value.trim().toLowerCase();
    const clock = /^(\d+):(\d{2})$/.exec(input);
    if (clock) {
        const hours = Number(clock[1]);
        const minutes = Number(clock[2]);
        return minutes < 60 && hours * 60 + minutes > 0 ? hours * 60 + minutes : null;
    }

    const parts = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(input);
    if (!parts || (!parts[1] && !parts[2])) return null;
    const minutes = Math.round((Number(parts[1] ?? 0) * 60) + Number(parts[2] ?? 0));
    return minutes > 0 ? minutes : null;
};

export const appendJsonl = (existing: string, entry: ActivityLogEntry): string => {
    const prefix = existing.trimEnd();
    return `${prefix ? `${prefix}\n` : ''}${JSON.stringify(entry)}\n`;
};
