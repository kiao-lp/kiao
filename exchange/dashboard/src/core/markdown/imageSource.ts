
/** Drops traversal above the DCMS root. */
const flatten = (path: string): string => {
    const segments: string[] = [];
    for (const segment of path.split('/')) {
        if (segment === '' || segment === '.') continue;
        if (segment === '..') segments.pop();
        else segments.push(segment);
    }
    return segments.join('/');
};

/** Return a file API path. DCMS links resolve from the DCMS root and relative image
 * destinations resolve from `documentFolder`. */
export const storePathOfImage = (src: string, documentFolder: string): string =>
    src.startsWith('/') ? flatten(src) : flatten(`${documentFolder}/${src}`);
