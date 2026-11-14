/** A `.src.md` declares its static twin by name alone: remove `.src`; no manifest is required. */

export const STATIC_SOURCE_SUFFIX = '.src.md';

export interface StaticVersionTarget {
    source: string;
    /** Generated markdown path, with `.src` removed. */
    output: string;
    /** Image folder relative to `output`, for image links. */
    assetFolder: string;
    /** Image folder path in the store. */
    assetFolderPath: string;
}

/** Returns null for non-sources; suffix matching ignores case but output names preserve it. */
export const staticVersionTarget = (source: string): StaticVersionTarget | null => {
    if (!source.toLowerCase().endsWith(STATIC_SOURCE_SUFFIX)) return null;

    const stem = source.slice(0, -STATIC_SOURCE_SUFFIX.length);
    const base = stem.slice(stem.lastIndexOf('/') + 1);
    // A bare `.src.md` has no output name.
    if (!base) return null;

    return {
        source,
        output: `${stem}.md`,
        assetFolder: `${base}.assets`,
        assetFolderPath: `${stem}.assets`,
    };
};
