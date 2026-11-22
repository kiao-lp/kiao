import { describe, it, expect } from 'vitest';
import { ReindexResult } from 'kiao-worker';
import { UploadOutcome, UploadTree } from './folderUpload';
import {
    buildReview,
    importedZips,
    importSummary,
    isFullyDecided,
    isReadableAsText,
    planImport,
    reviewTree,
    reviewableFiles,
    textImportName,
} from './uploadReview';

const STAGING = '.kiao-uploads/u-1-abc';

const tree = (paths: string[], emptyDirs: string[] = []): UploadTree => ({
    items: paths.map(p => {
        const cut = p.lastIndexOf('/');
        return {
            file: new File(['body'], cut < 0 ? p : p.slice(cut + 1)),
            relativeDir: cut < 0 ? '' : p.slice(0, cut),
        };
    }),
    emptyDirs,
});

const uploaded: UploadOutcome = { succeeded: 0, failed: [] };

const converted = (...indexPaths: string[]): ReindexResult => ({
    indexed: indexPaths.map(p => `${STAGING}/${p}`),
    upToDate: 0,
    failed: [],
    truncated: false,
});

describe('buildReview', () => {
    it('pairs each uploaded file with the index the conversion actually wrote', () => {
        const review = buildReview(
            STAGING, 'archive',
            tree(['rapport.pdf', 'photo.jpg', 'notes/minutes.docx']),
            uploaded,
            converted('rapport.pdf.index.md', 'notes/minutes.docx.index.md'));

        expect(review.files.map(f => [f.relativePath, f.indexPath])).toEqual([
            ['notes/minutes.docx', 'notes/minutes.docx.index.md'],
            ['photo.jpg', ''],
            ['rapport.pdf', 'rapport.pdf.index.md'],
        ]);
    });

    // Failed or truncated conversions have no index.
    it('leaves a convertible file with no index when none was written for it', () => {
        const review = buildReview(STAGING, '', tree(['broken.pdf']), uploaded, converted());
        expect(review.files[0].indexPath).toBe('');
        expect(reviewableFiles(review)).toHaveLength(0);
    });

    // Plain-text files are readable without conversion.
    it('reads a text file as itself, with no index between', () => {
        const review = buildReview(
            STAGING, '',
            tree(['notes.txt', 'readme.md', 'rows.csv', 'photo.jpg', 'archive.zip']),
            uploaded, converted());

        expect(review.files.map(f => [f.relativePath, f.textPath, f.indexPath])).toEqual([
            ['archive.zip', '', ''],
            ['notes.txt', 'notes.txt', ''],
            ['photo.jpg', '', ''],
            ['readme.md', 'readme.md', ''],
            ['rows.csv', 'rows.csv', ''],
        ]);
        expect(reviewableFiles(review).map(f => f.name)).toEqual(['notes.txt', 'readme.md', 'rows.csv']);
    });

    // Markdown is rendered rather than shown as source, and an index is Markdown too.
    it('says which of the texts are Markdown', () => {
        const review = buildReview(
            STAGING, '',
            tree(['readme.md', 'rows.csv', 'rapport.pdf', 'budget.xlsx']),
            uploaded, converted('rapport.pdf.index.md', 'budget.xlsx.index.csv'));

        expect(review.files.map(f => [f.name, f.isMarkdown])).toEqual([
            ['budget.xlsx', false], // its index is a .csv
            ['rapport.pdf', true],  // its index is a .md
            ['readme.md', true],
            ['rows.csv', false],
        ]);
    });

    it('leaves out what the upload could not write, and names it instead', () => {
        const outcome: UploadOutcome = {
            succeeded: 1,
            failed: [{ path: `${STAGING}/too-big.pdf`, error: new Error('413') }],
        };
        const review = buildReview(STAGING, '', tree(['ok.pdf', 'too-big.pdf']), outcome, converted('ok.pdf.index.md'));

        expect(review.files.map(f => f.relativePath)).toEqual(['ok.pdf']);
        expect(review.failed).toEqual([`${STAGING}/too-big.pdf`]);
    });
});

describe('reviewTree', () => {
    it('rebuilds the uploaded folders, empty ones included, folders before files', () => {
        const review = buildReview(
            STAGING, '',
            tree(['top.pdf', 'mail/a.eml', 'mail/sub/b.eml'], ['scans/empty']),
            uploaded, converted());

        expect(reviewTree(review).map(n => n.name)).toEqual(['mail', 'scans', 'top.pdf']);
        const mail = reviewTree(review)[0];
        expect(mail.children.map(n => n.path)).toEqual(['mail/sub', 'mail/a.eml']);
        expect(reviewTree(review)[1].children.map(n => n.path)).toEqual(['scans/empty']);
    });
});

describe('the gate on Safe import', () => {
    const review = buildReview(
        STAGING, 'archive',
        tree(['rapport.pdf', 'photo.jpg', 'notes/minutes.docx']),
        uploaded,
        converted('rapport.pdf.index.md', 'notes/minutes.docx.index.md'));

    it('holds until every converted document has been decided', () => {
        expect(isFullyDecided(review, {})).toBe(false);
        expect(isFullyDecided(review, { 'rapport.pdf': 'import' })).toBe(false);
        expect(isFullyDecided(review, { 'rapport.pdf': 'import', 'notes/minutes.docx': 'delete' })).toBe(true);
    });

    // Files with no shown text require no decision.
    it('never waits on a file that has no index', () => {
        const noIndex = buildReview(STAGING, '', tree(['photo.jpg']), uploaded, converted());
        expect(isFullyDecided(noIndex, {})).toBe(true);
    });
});

describe('planImport', () => {
    const review = buildReview(
        STAGING, 'archive',
        tree(['rapport.pdf', 'photo.jpg', 'notes/minutes.docx', 'notes/deep/old.pdf'], ['scans/empty']),
        uploaded,
        converted('rapport.pdf.index.md', 'notes/minutes.docx.index.md', 'notes/deep/old.pdf.index.md'));

    it('moves what is kept, under the target, with the uploaded structure intact', () => {
        const plan = planImport(review, { 'rapport.pdf': 'import', 'notes/minutes.docx': 'import', 'notes/deep/old.pdf': 'import' });
        expect(plan.moves).toEqual([
            { from: `${STAGING}/notes/deep/old.pdf`, to: 'archive/notes/deep/old.pdf' },
            { from: `${STAGING}/notes/minutes.docx`, to: 'archive/notes/minutes.docx' },
            { from: `${STAGING}/photo.jpg`, to: 'archive/photo.jpg' },
            { from: `${STAGING}/rapport.pdf`, to: 'archive/rapport.pdf' },
        ]);
    });

    it('leaves a file marked for deletion where it is, so the staging area takes it', () => {
        const plan = planImport(review, { 'rapport.pdf': 'delete', 'notes/minutes.docx': 'import', 'notes/deep/old.pdf': 'delete' });
        expect(plan.moves.map(m => m.to)).toEqual(['archive/notes/minutes.docx', 'archive/photo.jpg']);
    });

    // Undecided files import by default; this defines Unsafe import.
    it('imports an undecided file', () => {
        expect(planImport(review, {}).moves).toHaveLength(4);
    });

    // `createFolder` is `mkdir -p`; deepest paths create all parents.
    it('asks only for the deepest folders, and for the empty ones', () => {
        const plan = planImport(review, {});
        expect(plan.folders).toEqual(['archive/notes/deep', 'archive/scans/empty']);
    });

    it('drops a folder whose only files were all deleted', () => {
        const plan = planImport(review, { 'notes/minutes.docx': 'delete', 'notes/deep/old.pdf': 'delete' });
        expect(plan.folders).toEqual(['archive/scans/empty']);
    });
});

describe('Import as text', () => {
    const review = buildReview(
        STAGING, 'archive',
        tree(['rapport.pdf', 'notes/budget.xlsx', 'photo.jpg']),
        uploaded,
        converted('rapport.pdf.index.md', 'notes/budget.xlsx.index.csv'));

    // Text name keeps the original extension: `rapport.pdf.md`.
    it('names the index after the file it was made from', () => {
        expect(textImportName('rapport.pdf.index.md')).toBe('rapport.pdf.md');
        expect(textImportName('notes/budget.xlsx.index.csv')).toBe('notes/budget.xlsx.csv');
        expect(textImportName('deep/a.b.c.pdf.index.md')).toBe('deep/a.b.c.pdf.md');
    });

    it('moves the index instead of the file, and leaves the file behind', () => {
        const plan = planImport(review, { 'rapport.pdf': 'text', 'notes/budget.xlsx': 'text' });

        expect(plan.moves).toEqual([
            { from: `${STAGING}/notes/budget.xlsx.index.csv`, to: 'archive/notes/budget.xlsx.csv' },
            { from: `${STAGING}/photo.jpg`, to: 'archive/photo.jpg' },
            { from: `${STAGING}/rapport.pdf.index.md`, to: 'archive/rapport.pdf.md' },
        ]);
        // Original stays in staging and is discarded with it.
        expect(plan.moves.some(m => m.from.endsWith('/rapport.pdf'))).toBe(false);
    });

    it('still makes the folder the text lands in', () => {
        expect(planImport(review, { 'notes/budget.xlsx': 'text' }).folders).toEqual(['archive/notes']);
    });

    // Defensive: "text" without an index imports the whole file.
    it('imports the file whole when it was marked as text but has none', () => {
        const plan = planImport(review, { 'photo.jpg': 'text' });
        expect(plan.moves).toContainEqual({ from: `${STAGING}/photo.jpg`, to: 'archive/photo.jpg' });
    });
});

describe('obfuscated passages', () => {
    const review = buildReview(
        STAGING, 'archive',
        tree(['rapport.pdf', 'notes.txt']),
        uploaded,
        converted('rapport.pdf.index.md'));

    // Redactions write to staging before any move.
    it('writes the redacted text back where the reader read it', () => {
        const plan = planImport(review, {}, {
            'rapport.pdf.index.md': '# Rapport\n\nthe key is [...]',
            'notes.txt': 'a note with [...] in it',
        });

        // Edits are in path order, not redaction order.
        expect(plan.edits).toEqual([
            { path: `${STAGING}/notes.txt`, content: 'a note with [...] in it' },
            { path: `${STAGING}/rapport.pdf.index.md`, content: '# Rapport\n\nthe key is [...]' },
        ]);
    });

    it('does not write into a file that is about to be thrown away', () => {
        const plan = planImport(review, { 'notes.txt': 'delete' }, { 'notes.txt': 'redacted' });
        expect(plan.edits).toEqual([]);
    });

    it('has nothing to write when nobody obfuscated anything', () => {
        expect(planImport(review, {}).edits).toEqual([]);
    });
});

describe('isReadableAsText', () => {
    it('knows what can be read without a converter', () => {
        for (const name of ['a.md', 'a.txt', 'a.csv', 'a.json', 'a.yml', 'a.html', 'a.srt', 'a.go', 'go.mod', 'go.sum']) {
            expect(isReadableAsText(name), name).toBe(true);
        }
        // Covers editor-opened types and whole-name files.
        for (const name of ['a.sh', 'a.bash', 'a.ts', 'a.tsx', 'a.mts', 'a.cts', 'a.js', 'a.jsx',
            'a.mjs', 'a.cjs', 'a.java', 'a.rs', 'a.py', 'a.kt', 'a.kts', 'a.cls',
            'go.work', 'go.work.sum', '.gitignore', '.kiao-files']) {
            expect(isReadableAsText(name), name).toBe(true);
        }
        // `.docx` is a zip; it needs conversion, so it is excluded.
        for (const name of ['a.docx', 'a.pdf', 'a.jpg', 'a.zip', 'noextension']) {
            expect(isReadableAsText(name), name).toBe(false);
        }
    });
});

describe('importSummary', () => {
    const review = buildReview(STAGING, '', tree(['a.pdf', 'b.pdf', 'c.pdf']), uploaded, converted());

    it('counts what went in and what went away', () => {
        expect(importSummary(review, { 'a.pdf': 'delete' })).toBe('2 files imported, 1 deleted');
        expect(importSummary(review, {})).toBe('3 files imported');
    });

    it('counts the ones that went in as their own text separately', () => {
        const withIndexes = buildReview(STAGING, '', tree(['a.pdf', 'b.pdf', 'c.pdf']), uploaded,
            converted('a.pdf.index.md', 'b.pdf.index.md'));
        expect(importSummary(withIndexes, { 'a.pdf': 'text', 'b.pdf': 'delete' }))
            .toBe('1 file imported, 1 as text, 1 deleted');
    });
});

describe('importedZips', () => {
    const review = buildReview(
        STAGING, 'archive',
        tree(['bundle.zip', 'sub/nested.ZIP', 'photo.jpg', 'notes.txt']),
        uploaded, converted());

    it('names the kept archives where the import put them', () => {
        expect(importedZips(review, {})).toEqual(['archive/bundle.zip', 'archive/sub/nested.ZIP']);
    });

    // Deleted archives are discarded with staging.
    it('leaves out an archive marked for deletion', () => {
        expect(importedZips(review, { 'bundle.zip': 'delete' })).toEqual(['archive/sub/nested.ZIP']);
    });
});
