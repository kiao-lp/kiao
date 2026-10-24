import { describe, expect, it } from 'vitest';
import { EMPTY_CONFIG, TIMESHEET_DAY_MINUTES, appendJsonl, buildTimesheetCsv, collectActivityEntries, configPathFor, dateFromLogPath, durationInMinutes, folderOf, formatBookedDuration, formatClockDuration, formatTimesheetDuration, invalidateFolderConfig, loadFolderConfig, logPathFor, parseActivityLogEntries, readConfig, summarizeActivityLog, timesheetDates, today, totalBookedMinutes, upsertTemplate } from './activityLog';

describe('activity log storage helpers', () => {
    it('keeps configuration and daily logs directly in the opened folder', () => {
        expect(configPathFor('projects/kiao/')).toBe('projects/kiao/config.json');
        expect(logPathFor('projects/kiao', '2026-08-04')).toBe('projects/kiao/2026-08-04.actlog.jsonl');
    });

    it('extracts the date from a dated log filename only', () => {
        expect(dateFromLogPath('projects/kiao/2026-08-04.actlog.jsonl')).toBe('2026-08-04');
        expect(dateFromLogPath('projects/kiao/2026-08-04.jsonl')).toBeNull();
        expect(dateFromLogPath('projects/kiao/activity.jsonl')).toBeNull();
        expect(dateFromLogPath('projects/kiao/2026-08-04.json')).toBeNull();
    });

    it('normalizes project and template configuration and tolerates malformed files', () => {
        expect(readConfig('{"projects":[" Kiao ","Kiao","Blog",4],"templates":['
            + '{"project":"Kiao","durationMinutes":90,"description":" Review "},'
            + '{"project":"Blog","durationMinutes":45,"description":"Meeting"},'
            + '{"description":"Review"},'
            + '{"project":"X","durationMinutes":-5,"description":"Bad"},'
            + '{"description":"  "},4]}'))
            .toEqual({
                projects: ['Blog', 'Kiao'],
                templates: [
                    { project: 'X', description: 'Bad' },
                    { project: 'Blog', durationMinutes: 45, description: 'Meeting' },
                    { project: 'Kiao', durationMinutes: 90, description: 'Review' },
                ],
                projectColors: {},
            });
        expect(readConfig('not json')).toEqual({ projects: [], templates: [], projectColors: {} });
    });

    it('loads legacy description-only configs as templates without project or time', () => {
        expect(readConfig('{"projects":["Blog"],"descriptions":[" Meeting ","Meeting","Review",7]}'))
            .toEqual({
                projects: ['Blog'],
                templates: [{ description: 'Meeting' }, { description: 'Review' }],
                projectColors: {},
            });
    });

    it('defaults missing template configuration to an empty list', () => {
        expect(readConfig('{"projects":["Blog"]}')).toEqual({ projects: ['Blog'], templates: [], projectColors: {} });
    });

    it('keeps the project colours naming a palette slot or a hex override', () => {
        expect(readConfig('{"projects":["Blog"],"projectColors":{'
            + '" Blog ":"blue","Docs":"#1a2b3c","Kiao":"#ABC","Ninth":"other",'
            + '"Bad":"turquoise","Worse":"#12345","Empty":"","  ":"red","Wrong":7}}').projectColors)
            .toEqual({ Blog: 'blue', Docs: '#1a2b3c', Kiao: '#ABC', Ninth: 'other' });
        expect(readConfig('{"projectColors":["blue"]}').projectColors).toEqual({});
        expect(readConfig('{"projectColors":"blue"}').projectColors).toEqual({});
    });

    it('keeps the timesheet identity when it names something, and drops it otherwise', () => {
        expect(readConfig('{"projects":[],"resourceUnit":" ITDS ","resourceName":"Alex Example"}'))
            .toEqual({ projects: [], templates: [], projectColors: {}, resourceUnit: 'ITDS', resourceName: 'Alex Example' });
        expect(readConfig('{"projects":[],"resourceUnit":"  ","resourceName":7}'))
            .toEqual({ projects: [], templates: [], projectColors: {} });
    });

    it('reads the folder a log or config file belongs to', () => {
        expect(folderOf('projects/kiao/2026-08-04.actlog.jsonl')).toBe('projects/kiao/');
        expect(folderOf('2026-08-04.actlog.jsonl')).toBe('');
        expect(configPathFor(folderOf('projects/kiao/2026-08-04.actlog.jsonl'))).toBe('projects/kiao/config.json');
        expect(configPathFor(folderOf('2026-08-04.actlog.jsonl'))).toBe('config.json');
    });

    it('adds or replaces a reusable template keyed by description', () => {
        const templates = [
            { description: 'Meeting' },
            { project: 'Kiao', durationMinutes: 90, description: 'Review' },
        ];
        expect(upsertTemplate(templates, { project: 'Blog', durationMinutes: 30, description: 'Write' }))
            .toEqual([
                { description: 'Meeting' },
                { project: 'Kiao', durationMinutes: 90, description: 'Review' },
                { project: 'Blog', durationMinutes: 30, description: 'Write' },
            ]);
        expect(upsertTemplate(templates, { project: 'Blog', durationMinutes: 120, description: 'Review' }))
            .toEqual([
                { description: 'Meeting' },
                { project: 'Blog', durationMinutes: 120, description: 'Review' },
            ]);
    });

    it('parses common duration formats', () => {
        expect(durationInMinutes('1h 30m')).toBe(90);
        expect(durationInMinutes('1.5h')).toBe(90);
        expect(durationInMinutes('01:30')).toBe(90);
        expect(durationInMinutes('0m')).toBeNull();
    });

    it('appends exactly one JSON object per line', () => {
        expect(appendJsonl('{"first":true}\n', { date: '2026-08-04', project: 'Kiao', durationMinutes: 60 }))
            .toBe('{"first":true}\n{"date":"2026-08-04","project":"Kiao","durationMinutes":60}\n');
    });

    it('escapes multiline comments inside a single JSON line', () => {
        const line = appendJsonl('', {
            date: '2026-08-04',
            project: 'Kiao',
            durationMinutes: 60,
            comment: 'First line\nSecond line',
        }).trim();
        expect(line.split('\n')).toHaveLength(1);
        expect(JSON.parse(line).comment).toBe('First line\nSecond line');
    });

    it('totals valid booked durations and formats them for the file label', () => {
        const log = [
            '{"durationMinutes":90}',
            'not json',
            '{"durationMinutes":45}',
            '{"durationMinutes":-10}',
        ].join('\n');
        expect(totalBookedMinutes(log)).toBe(135);
        expect(formatBookedDuration(135)).toBe('2h 15m');
    });

    it('summarizes daily totals per project for the file label', () => {
        const log = [
            '{"date":"2026-08-04","project":"Kiao","durationMinutes":90}',
            '{"date":"2026-08-04","project":"Blog","durationMinutes":45}',
            '{"date":"2026-08-04","project":"Kiao","durationMinutes":30}',
            'not json',
            '{"date":"2026-08-04","project":"  ","durationMinutes":30}',
        ].join('\n');
        expect(summarizeActivityLog(log)).toEqual({
            totalMinutes: 165,
            projects: [
                { project: 'Blog', minutes: 45, activities: [{ description: '', minutes: 45 }] },
                { project: 'Kiao', minutes: 120, activities: [{ description: '', minutes: 120 }] },
            ],
        });
    });

    it('lists what was done per project, longest first, gathering repeats of a description', () => {
        const log = [
            '{"date":"2026-08-04","project":"Kiao","durationMinutes":30,"description":"Review"}',
            '{"date":"2026-08-04","project":"Kiao","durationMinutes":45,"description":"Meeting"}',
            '{"date":"2026-08-04","project":"Kiao","durationMinutes":60,"description":" Review "}',
            '{"date":"2026-08-04","project":"Kiao","durationMinutes":15}',
        ].join('\n');
        expect(summarizeActivityLog(log).projects).toEqual([{
            project: 'Kiao',
            minutes: 150,
            activities: [
                { description: 'Review', minutes: 90 },
                { description: 'Meeting', minutes: 45 },
                { description: '', minutes: 15 },
            ],
        }]);
    });

    it('formats compact clock durations for the file label', () => {
        expect(formatClockDuration(0)).toBe('0:00');
        expect(formatClockDuration(90)).toBe('1:30');
        expect(formatClockDuration(240)).toBe('4:00');
    });

    it('parses valid entries from a JSON Lines log and ignores malformed ones', () => {
        const log = [
            '{"date":"2026-08-04","project":"Kiao","durationMinutes":90,"description":"Review","comment":"Blocked on review\\nWaiting for input"}',
            'not json',
            '{"date":"2026-08-04","project":"Kiao","durationMinutes":-5}',
            '{"date":"2026-08-04","project":"  ","durationMinutes":30}',
            '{"date":"2026-08-04","project":"Kiao","durationMinutes":30,"comment":"   "}',
            '{"date":"2026-08-05","project":"Blog","durationMinutes":45}',
        ].join('\n');
        expect(parseActivityLogEntries(log)).toEqual([
            { date: '2026-08-04', project: 'Kiao', durationMinutes: 90, description: 'Review', comment: 'Blocked on review\nWaiting for input' },
            { date: '2026-08-04', project: 'Kiao', durationMinutes: 30 },
            { date: '2026-08-05', project: 'Blog', durationMinutes: 45 },
        ]);
    });

    it('collects entries from every actlog file of the opened folder only', async () => {
        const client = {
            listFiles: async () => [
                { path: 'projects/kiao/2026-08-04.actlog.jsonl', isDirectory: false },
                { path: 'projects/kiao/2026-08-05.actlog.jsonl', isDirectory: false },
                { path: 'projects/kiao/notes.txt', isDirectory: false },
                { path: 'projects/kiao/backup', isDirectory: true },
            ],
            getFileText: async (path: string) => path === 'projects/kiao/2026-08-04.actlog.jsonl'
                ? '{"date":"2026-08-04","project":"Kiao","durationMinutes":90}\n'
                : '{"date":"2026-08-05","project":"Blog","durationMinutes":45}\n',
        };
        await expect(collectActivityEntries(client, 'projects/kiao')).resolves.toEqual([
            { date: '2026-08-04', project: 'Kiao', durationMinutes: 90 },
            { date: '2026-08-05', project: 'Blog', durationMinutes: 45 },
        ]);
    });

    it('reads the configuration of a folder once for all its rows', async () => {
        let reads = 0;
        const client = {
            getFileText: async (path: string) => {
                reads += 1;
                return path === 'projects/kiao/config.json'
                    ? '{"projects":["Kiao"],"projectColors":{"Kiao":"blue"}}'
                    : '{"projects":["Blog"]}';
            },
        };

        invalidateFolderConfig();
        const rows = await Promise.all([
            loadFolderConfig(client, 'projects/kiao/'),
            loadFolderConfig(client, 'projects/kiao/'),
            loadFolderConfig(client, 'projects/kiao/'),
        ]);
        expect(reads).toBe(1);
        expect(rows.map(config => config.projectColors)).toEqual([{ Kiao: 'blue' }, { Kiao: 'blue' }, { Kiao: 'blue' }]);

        // Browsing away, and being told the file was rewritten, both read again.
        await loadFolderConfig(client, 'projects/blog/');
        expect(reads).toBe(2);
        invalidateFolderConfig();
        await loadFolderConfig(client, 'projects/blog/');
        expect(reads).toBe(3);
    });

    it('treats a folder without a readable configuration as an empty one', async () => {
        invalidateFolderConfig();
        const client = { getFileText: async () => { throw new Error('not found'); } };
        await expect(loadFolderConfig(client, 'projects/empty/')).resolves.toEqual(EMPTY_CONFIG);
    });

    it('formats durations like the timesheet template', () => {
        expect(formatTimesheetDuration(60)).toBe('1h00');
        expect(formatTimesheetDuration(90)).toBe('1h30');
        expect(formatTimesheetDuration(225)).toBe('3h45');
    });

    it('lists every date of the timesheet period inclusively', () => {
        const dates = timesheetDates('2026-07-30', '2026-08-02');
        expect(dates).toEqual(['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02']);
        expect(timesheetDates()).toHaveLength(92);
        expect(timesheetDates()[0]).toBe('2026-07-01');
        const defaultDates = timesheetDates();
        expect(defaultDates[defaultDates.length - 1]).toBe('2026-09-30');
    });

    it('builds a completed timesheet CSV with fixed resource values', () => {
        const csv = buildTimesheetCsv([
            { date: '2026-07-01', project: '[Innovation] ISO Facilitated Royalties Management', durationMinutes: 60 },
            { date: '2026-07-01', project: 'Kiao', durationMinutes: 30 },
            { date: '2026-07-02', project: 'Kiao', durationMinutes: 45 },
            { date: '2026-10-01', project: 'Outside Range', durationMinutes: 120 },
        ], { resourceUnit: 'ITDS', resourceName: 'Alex Example', dates: ['2026-07-01', '2026-07-02'] });

        expect(csv.split('\r\n')[0])
            .toBe('Resource Unit,Resource Name,Project Name,2026-07-01,2026-07-02');
        expect(csv).toContain('ITDS,Alex Example,Kiao,2h35,7h45');
        expect(csv).toContain('ITDS,Alex Example,[Innovation] ISO Facilitated Royalties Management,5h10,');
        expect(csv).not.toContain('Outside Range');
        expect(csv.endsWith('\r\n')).toBe(true);
    });

    it('scales each day to a fixed 7h 45m with multiples of 5 minutes', () => {
        const csv = buildTimesheetCsv([
            { date: '2026-07-01', project: 'Kiao', durationMinutes: 90 },
            { date: '2026-07-01', project: 'Blog', durationMinutes: 30 },
        ], { resourceUnit: 'ITDS', resourceName: 'Alex Example', dates: ['2026-07-01'] });
        expect(csv).toContain('ITDS,Alex Example,Blog,1h55');
        expect(csv).toContain('ITDS,Alex Example,Kiao,5h50');
    });

    it('keeps each scaled duration on the project that booked it', () => {
        const csv = buildTimesheetCsv([
            { date: '2026-07-01', project: 'Alpha', durationMinutes: 10 },
            { date: '2026-07-01', project: 'Beta', durationMinutes: 20 },
            { date: '2026-07-01', project: 'Gamma', durationMinutes: 30 },
            { date: '2026-07-01', project: 'Delta', durationMinutes: 60 },
        ], { resourceUnit: 'ITDS', resourceName: 'Alex Example', dates: ['2026-07-01'] });
        const rows = csv.split('\r\n').slice(1, -1).map(line => line.split(','));
        const minutesOf = (project: string): number => {
            const duration = rows.find(cells => cells[2] === project)?.[3] ?? '';
            return Number(duration.slice(0, -3)) * 60 + Number(duration.slice(-2));
        };
        // Booked shares are 1/12, 2/12, 3/12 and 6/12 of the day, so each project
        // keeps its own share once scaled to 7h45 and rounded to 5 minutes.
        expect(minutesOf('Alpha')).toBe(40);
        expect(minutesOf('Beta')).toBe(80);
        expect(minutesOf('Gamma')).toBe(115);
        expect(minutesOf('Delta')).toBe(230);
        expect(minutesOf('Alpha') + minutesOf('Beta') + minutesOf('Gamma') + minutesOf('Delta'))
            .toBe(TIMESHEET_DAY_MINUTES);
    });

    it('rounds scaled parts to multiples of 5 minutes that still sum to 7h 45m per day', () => {
        const csv = buildTimesheetCsv([
            { date: '2026-07-01', project: 'A', durationMinutes: 30 },
            { date: '2026-07-01', project: 'B', durationMinutes: 60 },
            { date: '2026-07-01', project: 'C', durationMinutes: 90 },
        ], { resourceUnit: 'ITDS', resourceName: 'Alex Example', dates: ['2026-07-01'] });
        const values = csv.split('\r\n').slice(1, -1).map(line => {
            const cells = line.split(',');
            const duration = cells[3];
            const hours = Number(duration.slice(0, -3));
            const minutes = Number(duration.slice(-2));
            return hours * 60 + minutes;
        });
        expect(values.every(value => value % 5 === 0)).toBe(true);
        expect(values.reduce((sum, value) => sum + value, 0)).toBe(TIMESHEET_DAY_MINUTES);
    });

    it('sums multiple entries of the same project and day and escapes CSV cells', () => {
        const csv = buildTimesheetCsv([
            { date: '2026-07-01', project: 'Kiao, "Team"', durationMinutes: 30 },
            { date: '2026-07-01', project: 'Kiao, "Team"', durationMinutes: 90 },
        ], { resourceUnit: 'ITDS', resourceName: 'Alex Example', dates: ['2026-07-01'] });
        expect(csv).toContain('ITDS,Alex Example,"Kiao, ""Team""",7h45');
    });

    it('formats today in local time', () => {
        expect(today(new Date('2026-08-03T23:30:00.000Z'))).toMatch(/^2026-08-\d{2}$/);
    });
});
