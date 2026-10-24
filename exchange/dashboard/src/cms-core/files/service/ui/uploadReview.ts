import { INDEXABLE_EXTENSIONS, MoveItem, ReindexResult } from 'kiao-worker';
import { UploadOutcome, UploadTree, joinPath } from './folderUpload';
import { isReadableAsText } from '../textFiles';

export { isReadableAsText } from '../textFiles';

/** `text` imports the converted index under the original name plus its text extension;
 * the original is discarded with staging. Offered only when conversion produced an index. */
export type UploadDecision = 'import' | 'delete' | 'text';

/** Decisions keyed by staging-relative path. */
export type UploadDecisions = Record<string, UploadDecision>;

export interface ReviewFile {
    /** Staging-relative path, preserved relative to the target folder on import. */
    relativePath: string;
    name: string;
    /** Staging-relative folder; '' at the upload root. */
    dir: string;
    /** Staging-relative converted index, or '' if absent. Enables Import as text. */
    indexPath: string;
    /** Staging-relative preview: converted index, original text file, or '' for unreadable files.
     * All nonempty previews require a decision, including text that needs no conversion. */
    textPath: string;
    isMarkdown: boolean;
}

export interface UploadReview {
    /** Staging area as a store path. */
    staging: string;
    /** Destination folder as a store path. */
    target: string;
    files: ReviewFile[];
    /** Directories with no file at any depth; recreated on import. */
    emptyDirs: string[];
    failed: string[];
    /** Conversion hit the server cap; some documents may lack an index without an error. */
    truncated: boolean;
}

export interface TextEdit {
    /** Store path of an index or original text file. */
    path: string;
    content: string;
}

/** Execute in order: edits, folder creation, moves. */
export interface ImportPlan {
    /** Write redactions in staging before moving, so imported text matches the reviewed content. */
    edits: TextEdit[];
    folders: string[];
    moves: MoveItem[];
}

const dirOf = (relativePath: string): string => {
    const cut = relativePath.lastIndexOf('/');
    return cut < 0 ? '' : relativePath.substring(0, cut);
};

const nameOf = (relativePath: string): string => relativePath.substring(relativePath.lastIndexOf('/') + 1);

/** Conversion suffix, or '' for a type with no converter. */
const indexSuffixFor = (name: string): string => {
    const dot = name.toLowerCase().lastIndexOf('.');
    return dot <= 0 ? '' : (INDEXABLE_EXTENSIONS[name.toLowerCase().slice(dot)] ?? '');
};

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx']);

const extensionOf = (name: string): string => {
    const dot = name.toLowerCase().lastIndexOf('.');
    return dot <= 0 ? '' : name.toLowerCase().slice(dot);
};

/** rapport.pdf.index.md becomes rapport.pdf.md; retain the original extension for provenance. */
export const textImportName = (indexPath: string): string => indexPath.replace(/\.index(\.[^.]+)$/, '$1');

/** Build from upload results and /reindex index paths. Avoid directory listings: they cap at
 * 500 entries and hide subsidiary files, including the indexes needed here. */
export const buildReview = (
    staging: string,
    target: string,
    tree: UploadTree,
    outcome: UploadOutcome,
    reindex: ReindexResult,
): UploadReview => {
    const failed = new Set(outcome.failed.map(f => f.path));
    const written = new Set(reindex.indexed);
    const files: ReviewFile[] = [];

    for (const item of tree.items) {
        const relativePath = joinPath(item.relativeDir, item.file.name);
        if (failed.has(joinPath(staging, relativePath))) continue;
        const suffix = indexSuffixFor(item.file.name);
        const indexPath = suffix && written.has(joinPath(staging, relativePath + suffix)) ? relativePath + suffix : '';
        const textPath = indexPath || (isReadableAsText(item.file.name) ? relativePath : '');
        files.push({
            relativePath,
            name: item.file.name,
            dir: item.relativeDir,
            indexPath,
            textPath,
            isMarkdown: textPath !== '' && MARKDOWN_EXTENSIONS.has(extensionOf(textPath)),
        });
    }

    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return {
        staging,
        target,
        files,
        emptyDirs: [...tree.emptyDirs].sort(),
        failed: outcome.failed.map(f => f.path),
        truncated: reindex.truncated,
    };
};

export interface ReviewNode {
    /** Staging-relative path, also the unique tree key. */
    path: string;
    name: string;
    /** Absent for folders. */
    file?: ReviewFile;
    children: ReviewNode[];
}

/** Folders first, then files, each sorted by name. Include empty directories to match the import. */
export const reviewTree = (review: UploadReview): ReviewNode[] => {
    const roots: ReviewNode[] = [];
    const folders = new Map<string, ReviewNode>();

    const folder = (path: string): ReviewNode[] => {
        if (path === '') return roots;
        const existing = folders.get(path);
        if (existing) return existing.children;
        const node: ReviewNode = { path, name: nameOf(path), children: [] };
        folders.set(path, node);
        folder(dirOf(path)).push(node);
        return node.children;
    };

    for (const dir of review.emptyDirs) folder(dir);
    for (const file of review.files) {
        folder(file.dir).push({ path: file.relativePath, name: file.name, file, children: [] });
    }

    const sort = (nodes: ReviewNode[]): ReviewNode[] => {
        nodes.sort((a, b) => (!a.file === !b.file ? a.name.localeCompare(b.name) : a.file ? 1 : -1));
        for (const node of nodes) sort(node.children);
        return nodes;
    };
    return sort(roots);
};

/** Files requiring decisions: those with readable previews. */
export const reviewableFiles = (review: UploadReview): ReviewFile[] => review.files.filter(f => f.textPath !== '');

/** Safe import requires decisions for every readable preview; binaries need no decision
 * because the reviewer was shown no content to assess. */
export const isFullyDecided = (review: UploadReview, decisions: UploadDecisions): boolean =>
    reviewableFiles(review).every(f => decisions[f.relativePath] !== undefined);

/** Safe and Unsafe use the same plan; only their decision requirements differ.
 * Undecided files are imported by default. Redactions are keyed by staging-relative textPath. */
export const planImport = (
    review: UploadReview,
    decisions: UploadDecisions,
    redactions: Record<string, string> = {},
): ImportPlan => {
    const kept = review.files.filter(f => decisions[f.relativePath] !== 'delete');
    const dirs = new Set<string>();
    for (const file of kept) if (file.dir !== '') dirs.add(file.dir);
    for (const dir of review.emptyDirs) if (dir !== '') dirs.add(dir);

    const edits: TextEdit[] = kept
        .filter(file => file.textPath !== '' && redactions[file.textPath] !== undefined)
        .map(file => ({ path: joinPath(review.staging, file.textPath), content: redactions[file.textPath] }));

    return {
        edits,
        // /createFolder creates parents (mkdir -p), so request only leaf folders.
        folders: [...dirs]
            .filter(dir => ![...dirs].some(other => other !== dir && other.startsWith(dir + '/')))
            .sort()
            .map(dir => joinPath(review.target, dir)),
        moves: kept.map(file => movedAs(review, file, decisions[file.relativePath])),
    };
};

/** Import the original unless `text` selects an index, leaving the original in staging.
 * If that index is missing, preserve the original rather than dropping a file marked to keep. */
const movedAs = (review: UploadReview, file: ReviewFile, decision: UploadDecision | undefined): MoveItem =>
    decision === 'text' && file.indexPath !== ''
        ? {
            from: joinPath(review.staging, file.indexPath),
            to: joinPath(review.target, textImportName(file.indexPath)),
        }
        : {
            from: joinPath(review.staging, file.relativePath),
            to: joinPath(review.target, file.relativePath),
        };

/** Store paths of the archives an import kept: what the unzip question is asked about. */
export const importedZips = (review: UploadReview, decisions: UploadDecisions): string[] =>
    review.files
        .filter(f => decisions[f.relativePath] !== 'delete' && f.name.toLowerCase().endsWith('.zip'))
        .map(f => joinPath(review.target, f.relativePath));

export const importSummary = (review: UploadReview, decisions: UploadDecisions): string => {
    const deleted = review.files.filter(f => decisions[f.relativePath] === 'delete').length;
    const asText = review.files.filter(f => decisions[f.relativePath] === 'text' && f.indexPath !== '').length;
    const imported = review.files.length - deleted - asText;
    const parts = [`${imported} file${imported === 1 ? '' : 's'} imported`];
    if (asText > 0) parts.push(`${asText} as text`);
    if (deleted > 0) parts.push(`${deleted} deleted`);
    return parts.join(', ');
};
