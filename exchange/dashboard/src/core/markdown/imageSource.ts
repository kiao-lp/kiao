
/** Drops traversal above the store root. */
const flatten = (path: string): string => {
    const segments: string[] = [];
    for (const segment of path.split('/')) {
        if (segment === '' || segment === '.') continue;
        if (segment === '..') segments.pop();
        else segments.push(segment);
    }
    return segments.join('/');
};

/** Worker path without leading slash. Leading `/` is store-root-relative; otherwise resolves against `documentFolder` (`''` is the root). */
export const storePathOfImage = (src: string, documentFolder: string): string =>
    src.startsWith('/') ? flatten(src) : flatten(`${documentFolder}/${src}`);
