import { parse } from 'yaml';

export const DECISIONS_PATH = 'kiao-user-config/decisions.json';

export interface DecisionSource {
    path: string;
    name: string;
}

export interface Decision {
    id: string;
    title: string;
    status: string;
    date: string;
    tags: string[];
    sourceName: string;
    path: string;
}

export const folderNameOf = (path: string): string =>
    path.replace(/\/+$/, '').split('/').pop() ?? '';

export const displayNameOf = (source: DecisionSource): string =>
    source.name.trim() || folderNameOf(source.path) || source.path;

export const readSources = (raw: unknown): DecisionSource[] => {
    if (!Array.isArray(raw)) return [];
    const sources: DecisionSource[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const source = entry as Record<string, unknown>;
        const path = typeof source.path === 'string' ? source.path.trim().replace(/\/+$/, '') : '';
        if (!path || seen.has(path)) continue;
        seen.add(path);
        sources.push({ path, name: typeof source.name === 'string' ? source.name : '' });
    }
    return sources;
};

export const sourcesFileText = (sources: DecisionSource[]): string =>
    `${JSON.stringify(sources.map(s => (s.name.trim() ? { path: s.path, name: s.name.trim() } : { path: s.path })), null, 2)}\n`;

export const withSourcePaths = (sources: DecisionSource[], paths: string[]): DecisionSource[] => {
    const next = [...sources];
    const seen = new Set(sources.map(s => s.path));
    for (const raw of paths) {
        const path = raw.trim().replace(/\/+$/, '');
        if (!path || seen.has(path)) continue;
        seen.add(path);
        next.push({ path, name: '' });
    }
    return next;
};

const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

const textOf = (value: unknown): string => {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
};

const tagsOf = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : [];

const recordOf = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const parseDecision = (path: string, sourceName: string, text: string): Decision | null => {
    const match = FRONTMATTER.exec(text);
    let data: Record<string, unknown> = {};
    if (match) {
        try {
            data = recordOf(parse(match[1]));
        } catch {
            data = {};
        }
    }
    const body = match ? text.slice(match[0].length) : text;
    const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim().replace(/\s+#+\s*$/, '') ?? '';
    const fileId = folderNameOf(path).replace(/\.md$/i, '').split('-')[0] ?? '';
    const id = fileId;
    const title = heading.replace(/^(?:ADR[- ]?)?\d+\s+[—–:-]\s+/i, '') || folderNameOf(path).replace(/\.md$/i, '');
    if (!id && !title) return null;
    return {
        id,
        title,
        status: textOf(data.status),
        date: textOf(data.date),
        tags: tagsOf(data.tags),
        sourceName,
        path,
    };
};

export const matchesQuery = (decision: Decision, query: string): boolean => {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return true;
    const haystack = [decision.status, decision.sourceName, ...decision.tags]
        .join(' ')
        .toLowerCase();
    return wanted.split(/\s+/).every(term => haystack.includes(term));
};

export const sortByDate = (decisions: Decision[], direction: 'asc' | 'desc'): Decision[] =>
    [...decisions].sort((a, b) => {
        if (a.date === b.date) return a.id.localeCompare(b.id);
        if (!a.date) return 1;
        if (!b.date) return -1;
        return direction === 'desc' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
    });

export const sortById = (decisions: Decision[], direction: 'asc' | 'desc'): Decision[] =>
    [...decisions].sort((a, b) => {
        const order = a.id.localeCompare(b.id, undefined, { numeric: true });
        return direction === 'desc' ? -order : order;
    });
