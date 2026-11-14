import { extractName, renameSelectionRange } from '../service';

/** A trailing " 3" on the base name: what a previous duplication left there, and what the next one counts from. */
const TRAILING_NUMBER = / \d+$/;

/** Same cap as worker' " (copy N)" search, so a pathological folder cannot spin the loop. */
const NUMBER_ATTEMPTS = 999;

/**
 * Splits a name into the part the number goes after and the suffix it must keep.
 *
 * The suffix is what a plugin declared, not what sits after the last dot: "notes.mmap.json" is a
 * mindmap because of ".mmap.json", so numbering it as "notes.mmap 1.json" would hand the copy to
 * no plugin at all. Only when nothing claims the name does the last dot decide, as worker
 * does for its own " (copy)" suffix — and a leading dot is not a separator, so a dotfile is a
 * name with no extension rather than an extension with no name.
 */
const splitAtExtension = (name: string, knownExtensions: string[]): [string, string] => {
    const { end } = renameSelectionRange(name, knownExtensions);
    if (end > 0 && end < name.length) return [name.slice(0, end), name.slice(end)];

    const dot = name.lastIndexOf('.');
    if (dot <= 0) return [name, ''];
    return [name.slice(0, dot), name.slice(dot)];
};

/**
 * The name a duplicate of `name` should take: the same name with a number between it and its
 * extension ("notes.md" → "notes 1.md"), the first one `takenNames` leaves free.
 *
 * A name that already carries such a number counts on from it rather than growing another one, so
 * duplicating "notes 1.md" gives "notes 2.md" and not "notes 1 1.md". The number is separated by a
 * space on purpose: gluing it on would read "report2024.md" as an already-numbered name and
 * quietly hand the copy the following year.
 */
export const duplicateName = (name: string, takenNames: string[], knownExtensions: string[]): string => {
    const [base, extension] = splitAtExtension(name, knownExtensions);
    const stem = base.replace(TRAILING_NUMBER, '') || base;
    const taken = new Set(takenNames);

    for (let n = 1; n < NUMBER_ATTEMPTS; n++) {
        const candidate = `${stem} ${n}${extension}`;
        if (!taken.has(candidate)) return candidate;
    }
    // Every number is taken. worker never overwrites, so it will settle the clash itself.
    return `${stem} ${NUMBER_ATTEMPTS}${extension}`;
};

/**
 * Where a duplicate of `path` should land: beside it, under {@link duplicateName}. `siblingPaths`
 * is the folder's listing — the names already spoken for.
 */
export const duplicatePath = (path: string, siblingPaths: string[], knownExtensions: string[]): string => {
    const name = duplicateName(extractName(path), siblingPaths.map(extractName), knownExtensions);
    const cut = path.lastIndexOf('/');
    return cut < 0 ? name : `${path.slice(0, cut + 1)}${name}`;
};

/** One entry of a duplication, in the shape `copyBatch` takes. */
export interface DuplicateItem {
    from: string;
    to: string;
}

/**
 * Where each of `paths` should be copied, all of them sharing the folder `siblingPaths` lists.
 *
 * A destination joins the taken names before the next one is chosen, so duplicating a whole
 * selection cannot hand two entries the same number — `copyBatch` would otherwise settle that
 * clash with the " (copy)" name this exists to avoid.
 */
export const duplicateItemsIn = (
    paths: string[],
    siblingPaths: string[],
    knownExtensions: string[],
): DuplicateItem[] => {
    const taken = [...siblingPaths];
    return paths.map(path => {
        const to = duplicatePath(path, taken, knownExtensions);
        taken.push(to);
        return { from: path, to };
    });
};
