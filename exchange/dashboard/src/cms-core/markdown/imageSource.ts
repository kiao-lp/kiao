
/** Discard traversal above the store root; worker rejects paths outside it. */
const flatten = (path: string): string => {
    const segments: string[] = [];
    for (const segment of path.split('/')) {
        if (segment === '' || segment === '.') continue;
        if (segment === '..') segments.pop();
        else segments.push(segment);
    }
    return segments.join('/');
};

/**
 * Return a worker path without a leading slash. A src starting with / is store-root-relative;
 * otherwise resolve against documentFolder (root-relative; '' denotes the store root).
 */
export const storePathOfImage = (src: string, documentFolder: string): string =>
    src.startsWith('/') ? flatten(src) : flatten(`${documentFolder}/${src}`);
