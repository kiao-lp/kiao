import { describe, it, expect } from 'vitest';
import {
    displayNameOf, matchesQuery, parseDecision, readSources, sortByDate, sortById, sourcesFileText, withSourcePaths,
} from './decisionsFile';

const ADR = `---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "accepted"
date: 2026-07-16
tags: ["dashboard", "plugins"]
triggers: ["plugin contract", "PluginAssemblyProvider"]
---

# 00003 — Each plugin exports one manifest.

Body.
`;

describe('readSources', () => {
    it('keeps valid entries, drops duplicates and blanks', () => {
        expect(readSources([
            { path: 'a/decisions/', name: 'A' },
            { path: 'a/decisions' },
            { path: '  ' },
            'nope',
            { path: 'b/decisions' },
        ])).toEqual([
            { path: 'a/decisions', name: 'A' },
            { path: 'b/decisions', name: '' },
        ]);
        expect(readSources(null)).toEqual([]);
    });
});

describe('displayNameOf', () => {
    it('falls back to the folder name', () => {
        expect(displayNameOf({ path: 'docs/decisions', name: '' })).toBe('decisions');
        expect(displayNameOf({ path: 'docs/decisions', name: 'Design' })).toBe('Design');
    });
});

describe('sourcesFileText', () => {
    it('omits an empty name', () => {
        expect(sourcesFileText([{ path: 'a/decisions', name: ' ' }])).toBe('[\n  {\n    "path": "a/decisions"\n  }\n]\n');
    });
});

describe('withSourcePaths', () => {
    it('adds new paths once', () => {
        expect(withSourcePaths([{ path: 'a', name: '' }], ['a', 'b/', ''])).toEqual([
            { path: 'a', name: '' },
            { path: 'b', name: '' },
        ]);
    });
});

describe('parseDecision', () => {
    it('reads MADR frontmatter and the heading', () => {
        expect(parseDecision('docs/decisions/00003-x.md', 'Design', ADR)).toEqual({
            id: '00003',
            title: 'Each plugin exports one manifest.',
            status: 'accepted',
            date: '2026-07-16',
            tags: ['dashboard', 'plugins'],
            sourceName: 'Design',
            path: 'docs/decisions/00003-x.md',
        });
    });

    it('reads MADR metadata independently from document metadata', () => {
        const source = `---
# This YAML comment is not the record title
status: "superseded by ADR-00004"
date: 2026-11-12
decision-makers: [Architecture group]
tags: [dashboard, 7, plugins]
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Each plugin exports one manifest. ###

## Context and Problem Statement

Plugins need a shared contract.

## Considered Options

* One manifest per plugin.

## Decision Outcome

Chosen option: "One manifest per plugin.", because it defines that contract.
`;
        expect(parseDecision('docs/decisions/00003-plugin-contract.md', 'Design', source)).toEqual({
            id: '00003',
            title: 'Each plugin exports one manifest.',
            status: 'superseded by ADR-00004',
            date: '2026-11-12',
            tags: ['dashboard', 'plugins'],
            sourceName: 'Design',
            path: 'docs/decisions/00003-plugin-contract.md',
        });
    });

    it('ignores nested decision metadata and uses the H1 and file name', () => {
        const source = `---
document:
  status: DRAFT
decision:
  id: "ignored"
  statement: "Ignored statement"
  status: DECIDED
  date: 2026-07-16
  tags: [ignored]
---

# Use a shared contract
`;
        expect(parseDecision('docs/decisions/00003-x.md', 'Design', source)).toMatchObject({
            id: '00003', title: 'Use a shared contract', status: '', date: '', tags: [],
        });
    });

    it('reads a bare MADR record without inventing optional metadata', () => {
        expect(parseDecision('docs/decisions/00007-plain.md', 'Design', '# Use a shared contract\n')).toMatchObject({
            id: '00007', title: 'Use a shared contract', status: '', date: '', tags: [],
        });
    });

    it('keeps a dash in the title when it is not an ID prefix', () => {
        expect(parseDecision('docs/decisions/00007-plain.md', 'Design', '# Deployment — trade-offs\n')?.title)
            .toBe('Deployment — trade-offs');
    });

    it.each(['status: [unfinished', '- accepted', 'null', 'decision: []'])('tolerates malformed or non-mapping metadata: %s', yaml => {
        expect(parseDecision('docs/decisions/00007-plain.md', 'Design', `\uFEFF---\r\n${yaml}\r\n---\r\n\r\n# Use a shared contract\r\n`))
            .toMatchObject({ id: '00007', title: 'Use a shared contract', status: '', date: '', tags: [] });
    });

    it('falls back to the file name without frontmatter', () => {
        const decision = parseDecision('docs/decisions/00007-plain.md', 'Design', '# Hello\n');
        expect(decision?.id).toBe('00007');
        expect(decision?.title).toBe('Hello');
        expect(decision?.date).toBe('');
    });
});

describe('filtering and sorting', () => {
    const base = [
        { id: '1', title: 'Alpha', status: 'accepted', date: '2026-01-01', tags: ['ui'], sourceName: 'Design', path: 'a/1.md' },
        { id: '2', title: 'Beta', status: 'proposed', date: '2026-03-01', tags: ['api'], sourceName: 'Backend', path: 'b/2.md' },
        { id: '3', title: 'Gamma', status: 'accepted', date: '', tags: [], sourceName: 'Design', path: 'a/3.md' },
    ];

    it('matches tags, status and source name', () => {
        expect(base.filter(d => matchesQuery(d, 'ui'))).toHaveLength(1);
        expect(base.filter(d => matchesQuery(d, 'proposed'))).toHaveLength(1);
        expect(base.filter(d => matchesQuery(d, 'backend'))).toHaveLength(1);
        expect(base.filter(d => matchesQuery(d, ''))).toHaveLength(3);
        const decision = parseDecision('docs/decisions/00003-x.md', 'Design', ADR)!;
        expect(matchesQuery(decision, 'dashboard')).toBe(true);
        expect(matchesQuery(decision, 'PluginAssemblyProvider')).toBe(false);
    });

    it('sorts by date with undated last', () => {
        expect(sortByDate(base, 'desc').map(d => d.id)).toEqual(['2', '1', '3']);
        expect(sortByDate(base, 'asc').map(d => d.id)).toEqual(['1', '2', '3']);
    });

    it('sorts numeric and prefixed IDs in both directions without changing the source order', () => {
        const ids = ['ADR-10', '00010', 'ADR-2', '00002', '1'];
        const decisions = ids.map(id => ({ ...base[0], id }));

        expect(sortById(decisions, 'asc').map(d => d.id)).toEqual(['1', '00002', '00010', 'ADR-2', 'ADR-10']);
        expect(sortById(decisions, 'desc').map(d => d.id)).toEqual(['ADR-10', 'ADR-2', '00010', '00002', '1']);
        expect(decisions.map(d => d.id)).toEqual(ids);
    });
});
